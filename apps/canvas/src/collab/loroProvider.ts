import { LoroAdaptor, LoroEphemeralAdaptor } from "loro-adaptors/loro";
import type { EphemeralStore, LoroDoc } from "loro-crdt";
import { CrdtType } from "loro-protocol";
import {
  LoroWebsocketClient,
  type LoroWebsocketClientRoom,
  type RoomJoinStatusValue,
} from "loro-websocket";

/**
 * The one sync state machine, reported to the title bar's status slot.
 *
 * - `connecting`: the socket is opening, or the first room join is in flight.
 * - `rejoining`: the relay is back, or a claim just landed, and the open
 *   document is rejoining its room to push the edits made while it was away.
 * - `connected`: the workspace room is joined and merged; edits stream live.
 * - `disconnected`: no usable relay — the socket is down or the browser is
 *   offline. Edits stay in the local document.
 * - `unauthorized`: the relay answered and refused this tab's credential (a
 *   revoked share, no account session, a seat the plan does not cover). The
 *   network is fine; access is the problem, and saying "offline" here sent people
 *   to check their connection.
 */
export type LoroConnectionStatus =
  | "connecting"
  | "rejoining"
  | "connected"
  | "disconnected"
  | "unauthorized";

/** Every event that can move the sync status. */
export type SyncEvent =
  | { type: "transport-connecting" }
  /** `everJoined` separates a first boot's "Syncing" from a return's "Reconnecting". */
  | { type: "transport-connected"; everJoined: boolean }
  | { type: "transport-lost" }
  | { type: "room-joined" }
  | { type: "room-refused" }
  | { type: "rejoin-requested" };

/**
 * Each transition, and exactly when it fires:
 *
 * - `transport-connecting` — the socket starts opening (boot, reconnect timer).
 *   A drop keeps reporting `disconnected` until the socket is actually open, so
 *   the status does not flap between Offline and Syncing on every retry.
 * - `transport-connected` — the socket is open. A join or rejoin starts now, so
 *   this is never reported as `connected` before the room is. A tab that has
 *   never been live is still "Syncing"; one that was live is "Reconnecting".
 * - `transport-lost` — the socket closed, or the browser went offline, even
 *   after a refusal: that is an ordinary disconnect, so "the network went away"
 *   and "the relay said no" stay separate states.
 * - `room-joined` — the workspace room handshake completed; the CRDT merge ran.
 * - `room-refused` — the relay answered and refused the credential, e.g. no
 *   session token or a revoked share token. The document keeps accepting local
 *   edits either way.
 * - `rejoin-requested` — a claim settled as `claimed`, or a reconnect returned.
 *   A live room stays live; anything else moves to `rejoining`.
 */
export function nextConnectionStatus(
  status: LoroConnectionStatus,
  event: SyncEvent,
): LoroConnectionStatus {
  switch (event.type) {
    case "transport-lost":
      return "disconnected";
    case "room-refused":
      return "unauthorized";
    case "room-joined":
      return "connected";
    case "rejoin-requested":
      return status === "connected" ? status : "rejoining";
    case "transport-connected":
      return event.everJoined ? "rejoining" : "connecting";
    case "transport-connecting":
      // A refusal is an answer from a reachable relay, so a reconnect attempt
      // does not turn it back into "Connecting"; the next refusal or a join
      // says which it is.
      return status === "disconnected" || status === "rejoining" || status === "unauthorized"
        ? status
        : "connecting";
  }
}

/**
 * The credential a join presents.
 *
 * A share token is a constant, so it can be bytes. An account session is a
 * five-minute JWT (ADR-0074): a provider that captured one at construction would
 * present a dead token after the first expiry, so it takes a function and asks
 * again on every join. Resolving `null` means "present nothing", which the relay
 * answers with a refusal rather than a silent downgrade.
 */
export type ProviderAuth = Uint8Array | (() => Promise<Uint8Array | null>);

export interface LoroProviderOptions {
  url: string;
  /** Sync room to join; the workspace, or a share projection room. */
  workspaceId: string;
  doc: LoroDoc;
  presence: EphemeralStore;
  cursors: EphemeralStore;
  /**
   * Capability token: the session JWT or a share token. The server scopes the
   * derived presence and cursor rooms to the same credential, so it is sent to
   * both joins. Optional only so tests can build a provider without one.
   */
  auth?: ProviderAuth;
  onStatus?: (status: LoroConnectionStatus) => void;
  onSynced?: () => void;
}

/**
 * Owns the workspace room and the presence room. Loro's protocol multiplexes
 * rooms over one socket, so cards/boards and ephemeral state can share a
 * connection without a second transport.
 *
 * The provider also owns the one re-join path: `rejoin()` runs the same `join()`
 * as boot on the same socket, so an offline document pushes what it changed
 * instead of opening a second connection or replacing itself with the relay's
 * copy. See `nextConnectionStatus` for the status transitions it reports.
 */
export class LoroProvider {
  readonly client: LoroWebsocketClient;
  private workspaceRoom: LoroWebsocketClientRoom | null = null;
  private presenceRoom: LoroWebsocketClientRoom | null = null;
  private cursorRoom: LoroWebsocketClientRoom | null = null;
  private joining: Promise<void> | null = null;
  /** The workspace room is joined right now, not merely known to this tab. */
  private joined = false;
  /** A live room has existed on this page, so a return is a reconnect. */
  private everJoined = false;
  private syncedOnce = false;
  private statusValue: LoroConnectionStatus = "connecting";
  private disposed = false;

  constructor(private readonly options: LoroProviderOptions) {
    this.client = new LoroWebsocketClient({
      url: options.url,
      onError: (error) => console.warn("[loro] transport error", error),
    });
    this.client.onStatusChange((status) => {
      if (status === "connected") {
        this.transition({ type: "transport-connected", everJoined: this.everJoined });
        // The library only re-joins rooms it already joined. A room refused at
        // boot (an unclaimed workspace) is not one of them, so retry here.
        void this.rejoin();
        return;
      }
      if (status === "connecting") {
        this.transition({ type: "transport-connecting" });
        return;
      }
      this.joined = false;
      this.transition({ type: "transport-lost" });
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onBrowserOnline);
    }
    void this.join();
  }

  /**
   * loro-websocket 0.6.2 closes a dropped socket with code 1001, which browsers
   * reject; the socket is then half-open, and the library's own reconnect sees
   * an OPEN socket and does nothing. On a real browser reconnect, close it with
   * a code the browser accepts and ask for a fresh connection. The following
   * `connected` transition runs `rejoin()`.
   */
  private readonly onBrowserOnline = (): void => {
    if (this.disposed || this.client.getStatus() !== "disconnected") return;
    try {
      this.client.socket?.close(1000, "browser online");
    } catch {
      // Already closing or closed; `connect` below is enough.
    }
    this.client.connect({ resetBackoff: true }).catch((error: unknown) => {
      console.warn("[loro] reconnect failed", error);
    });
  };

  /** Reports a status only when the state machine actually changes it. */
  private transition(event: SyncEvent): void {
    const next = nextConnectionStatus(this.statusValue, event);
    if (next === this.statusValue) return;
    this.statusValue = next;
    this.options.onStatus?.(next);
  }

  /**
   * Room status drives `joined` and the visible state. `connecting` and
   * `reconnecting` only mean the handshake is not finished; `error` is the
   * relay's refusal.
   */
  private readonly onWorkspaceRoomStatus = (status: RoomJoinStatusValue): void => {
    if (status === "joined") {
      this.joined = true;
      this.everJoined = true;
      this.transition({ type: "room-joined" });
      return;
    }
    this.joined = false;
    if (status === "error") this.transition({ type: "room-refused" });
  };

  /**
   * Re-join the room after the relay connection returns, or after a claim makes
   * a refused workspace joinable. The local document is the source of truth:
   * the adapter exports the operations the relay does not have, so offline edits
   * are pushed. A live room, or a join already in flight, makes this a no-op.
   */
  async rejoin(): Promise<void> {
    if (this.disposed || this.joined) return;
    this.transition({ type: "rejoin-requested" });
    await this.join();
  }

  /**
   * Settles with `work`, or rejects as soon as the socket drops. The client
   * leaves a join that was in flight when the transport closed in its pending
   * map — it neither resolves nor rejects it while it plans to reconnect — so
   * without this a rejoin interrupted by a second disconnect would hang forever
   * and the next reconnect would reuse the stranded promise.
   */
  private untilTransportLoses<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const unsubscribe = this.client.onStatusChange((status) => {
        if (settled || status !== "disconnected") return;
        settled = true;
        unsubscribe();
        reject(new Error("transport lost during join"));
      });
      work.then(
        (value) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          reject(error);
        },
      );
    });
  }

  /** The credential as it stands when a join is sent, not as it stood at boot. */
  private async resolveAuth(): Promise<Uint8Array | null> {
    const source = this.options.auth;
    if (source === undefined) return null;
    if (!(source instanceof Function)) return source;
    try {
      return await source();
    } catch {
      // A refused or unreachable mint is "no credential": the room join is then
      // refused, which the status slot already reports as "No access".
      return null;
    }
  }

  private async join(): Promise<void> {
    if (this.joining) return this.joining;
    this.joining = (async () => {
      await this.client.waitConnected();
      if (this.disposed) return;

      const credential = await this.resolveAuth();
      this.workspaceRoom = await this.untilTransportLoses(
        this.client.join({
          roomId: this.options.workspaceId,
          crdtAdaptor: new LoroAdaptor(this.options.doc),
          onStatusChange: this.onWorkspaceRoomStatus,
          ...(credential ? { auth: credential } : {}),
        }),
      );

      // The room handshake is complete. `waitForReachingServerVersion` never
      // resolves for a brand-new room with an empty server version, so don't
      // gate startup on it.
      if (!this.disposed && !this.syncedOnce) {
        this.syncedOnce = true;
        this.options.onSynced?.();
      }

      // A viewer token also writes the derived ephemeral rooms, so presence and
      // cursors work for every role. The credential is the same one the document
      // room just accepted.
      const auth = credential ? { auth: credential } : {};
      try {
        this.presenceRoom = await this.client.join({
          roomId: `${this.options.workspaceId}:presence`,
          // Presence must not be replayed to late joiners: a stale tab would
          // otherwise remain as a frozen collaborator until manually cleared.
          crdtAdaptor: new LoroEphemeralAdaptor(this.options.presence),
          ...auth,
        });
        this.cursorRoom = await this.client.join({
          roomId: `${this.options.workspaceId}:cursors`,
          crdtAdaptor: new LoroEphemeralAdaptor(this.options.cursors),
          ...auth,
        });
      } catch (error) {
        console.warn("[loro] presence rooms unavailable", error);
      }
    })()
      .catch((error) => {
        console.warn("[loro] join failed", error);
        // A join interrupted by a drop would otherwise stay in the client's
        // pending map, and the next reconnect would reuse that dead promise
        // instead of sending a fresh join request.
        this.client.cleanupRoom(this.options.workspaceId, CrdtType.Loro);
      })
      .finally(() => {
        this.joining = null;
      });
    return this.joining;
  }

  get status(): LoroConnectionStatus {
    return this.statusValue;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.join();
  }

  async flush(): Promise<void> {
    await this.workspaceRoom?.waitForReachingServerVersion();
  }

  destroy(): void {
    this.disposed = true;
    this.joined = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onBrowserOnline);
    }
    void this.workspaceRoom?.destroy();
    void this.presenceRoom?.destroy();
    void this.cursorRoom?.destroy();
    this.client.destroy();
  }
}
