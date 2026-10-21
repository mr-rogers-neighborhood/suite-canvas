import { LoroAdaptor, LoroEphemeralAdaptor } from "loro-adaptors/loro";
import type { EphemeralStore, LoroDoc } from "loro-crdt";
import { LoroWebsocketClient, type LoroWebsocketClientRoom } from "loro-websocket";

export type LoroConnectionStatus = "connecting" | "connected" | "disconnected";

export interface LoroProviderOptions {
  url: string;
  workspaceId: string;
  doc: LoroDoc;
  presence: EphemeralStore;
  cursors: EphemeralStore;
  onStatus?: (status: LoroConnectionStatus) => void;
  onSynced?: () => void;
}

/**
 * Owns the workspace room and the presence room. Loro's protocol multiplexes
 * rooms over one socket, so cards/boards and ephemeral state can share a
 * connection without a second transport.
 */
export class LoroProvider {
  readonly client: LoroWebsocketClient;
  private workspaceRoom: LoroWebsocketClientRoom | null = null;
  private presenceRoom: LoroWebsocketClientRoom | null = null;
  private cursorRoom: LoroWebsocketClientRoom | null = null;
  private joining: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly options: LoroProviderOptions) {
    this.client = new LoroWebsocketClient({
      url: options.url,
      onError: (error) => console.warn("[loro] transport error", error),
    });
    this.client.onStatusChange((status) => {
      options.onStatus?.(status as LoroConnectionStatus);
    });
    void this.join();
  }

  private async join(): Promise<void> {
    if (this.joining) return this.joining;
    this.joining = (async () => {
      await this.client.waitConnected();
      if (this.disposed) return;

      this.workspaceRoom = await this.client.join({
        roomId: this.options.workspaceId,
        crdtAdaptor: new LoroAdaptor(this.options.doc),
      });

      // The room handshake is complete. `waitForReachingServerVersion` never
      // resolves for a brand-new room with an empty server version, so don't
      // gate startup on it.
      if (!this.disposed) this.options.onSynced?.();

      try {
        this.presenceRoom = await this.client.join({
          roomId: `${this.options.workspaceId}:presence`,
          // Presence must not be replayed to late joiners: a stale tab would
          // otherwise remain as a frozen collaborator until manually cleared.
          crdtAdaptor: new LoroEphemeralAdaptor(this.options.presence),
        });
        this.cursorRoom = await this.client.join({
          roomId: `${this.options.workspaceId}:cursors`,
          crdtAdaptor: new LoroEphemeralAdaptor(this.options.cursors),
        });
      } catch (error) {
        console.warn("[loro] presence rooms unavailable", error);
      }
    })()
      .catch((error) => {
        console.warn("[loro] join failed", error);
      })
      .finally(() => {
        this.joining = null;
      });
    return this.joining;
  }

  get status(): LoroConnectionStatus {
    return this.client.getStatus() as LoroConnectionStatus;
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
    void this.workspaceRoom?.destroy();
    void this.presenceRoom?.destroy();
    void this.cursorRoom?.destroy();
    this.client.destroy();
  }
}
