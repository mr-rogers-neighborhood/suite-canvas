import { setTimeout as delay } from "node:timers/promises";
import {
  applyProjection,
  applyPublish,
  PROJECTION_APPLY_ORIGIN,
  type PublishConflict,
  planPublish,
  projectWorkspace,
  WorkspaceDocument,
} from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc, VersionVector } from "loro-crdt";
import { CrdtType } from "loro-protocol";
import { LoroWebsocketClient, type LoroWebsocketClientRoom, RoomJoinStatus } from "loro-websocket";
import { licenceRequired } from "./licence.js";
import type { DocumentStore } from "./persistence.js";
import type { Share, ShareRole, ShareStore } from "./shares.js";

/**
 * Store key of the Loro document in a sync room.
 *
 * Both the load and the save path go through this key: `loro-websocket` 0.6.2
 * parses its room key with `Number(...)`, so a save reports `NaN` where the join
 * reported `%LOR`. Every persisted room here holds a Loro document, so the type
 * is fixed rather than taken from the callback.
 */
export function loroDocumentKey(roomId: string): string {
  return `${CrdtType.Loro}:${roomId}`;
}

/**
 * Every key a Loro room may have been saved under, current one first. Builds
 * before `loroDocumentKey` used the CRDT type the server reported, which was
 * `loro` there and `NaN` once `loro-websocket` started parsing its key with
 * `Number(...)`; both are still read so an upgrade does not empty a workspace.
 */
export function loroDocumentKeys(roomId: string): string[] {
  return [loroDocumentKey(roomId), `loro:${roomId}`, `NaN:${roomId}`];
}

/** Stored state for a Loro room, falling back to the keys earlier builds wrote. */
export function loadLoroDocument(
  documents: Pick<DocumentStore, "load">,
  roomId: string,
): Uint8Array | null {
  for (const key of loroDocumentKeys(roomId)) {
    const state = documents.load(key);
    if (state) return state;
  }
  return null;
}

/** Scopes a projection worker keeps alive; workspace shares open the real room. */
type ProjectionTarget =
  | { scope: "board"; boardId: string }
  | { scope: "card"; cardId: string }
  | { scope: "selection"; boardId: string; cardIds: readonly string[] };

/** A target an editor draft may publish into; a selection share has none. */
type PublishTarget = { scope: "board"; boardId: string } | { scope: "card"; cardId: string };

export type ProjectionWorkerShares = Pick<
  ShareStore,
  "list" | "listAllActive" | "getBaseline" | "setBaseline" | "deleteBaseline"
> & {
  /**
   * Revokes one link. The idle sweep needs it; a store without it leaves the
   * sweep switched off rather than half-working.
   */
  revoke?: (id: string) => Share | null;
};

/** A share document's version vector as JSON, keyed by peer id. */
export type ShareVersion = Record<string, number>;

/** What a publish or reload did. A rejected publish returns the reasons instead. */
export type SharePublishResult =
  | { ok: true; applied: number }
  | { ok: false; conflicts: PublishConflict[]; unsupported: PublishConflict[]; reason?: string };

/** Whether a share's draft holds edits the workspace has not received yet. */
export interface ShareStatus {
  dirty: boolean;
  hasBaseline: boolean;
}

/** One room the worker holds, for the read-only operator inventory. */
export interface ProjectionRoomInfo {
  roomId: string;
  shareId: string;
  workspaceId: string;
  role: ShareRole;
  /** Whether the room has a projection baseline to diff its draft against. */
  hasBaseline: boolean;
  /** Whether an editor changed the draft since the last projection. */
  dirty: boolean;
}

/** One projection room the idle sweep closed, or would close on a dry run. */
export interface SweptRoom {
  roomId: string;
  shareId: string;
  workspaceId: string;
  /** Silence since the room was last refreshed or used, in milliseconds. */
  idleMs: number;
}

/**
 * What one sweep pass did. `checked` and `unknown` make a zero result readable:
 * a sweep that looked at nothing is not the same as a sweep that found nothing.
 */
export interface RoomSweepReport {
  /** Idle window applied, in hours; `0` means the sweep is switched off. */
  idleHours: number;
  dryRun: boolean;
  /** Rooms examined. */
  checked: number;
  /** Rooms whose connected sessions could not be read, so they were kept. */
  unknown: number;
  /** Rooms closed, or the rooms a dry run would close. */
  rooms: SweptRoom[];
}

/** The hosted relay's default idle window; a self-host sweeps nothing by default. */
export const DEFAULT_HOSTED_ROOM_IDLE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Hours a projection room may sit idle before the sweep revokes its link.
 *
 * `SUITE_ROOM_IDLE_HOURS` wins when it is a non-negative number; `0` switches
 * the sweep off. The default follows the same switch the rest of the hosted
 * behaviour does (`licenceRequired()`, i.e. `SUITE_HOSTED=1`): a relay expires
 * links nobody came back to, a self-host keeps every link warm as it always has.
 */
export function roomIdleHours(
  env: { SUITE_ROOM_IDLE_HOURS?: string | undefined } = process.env,
  hosted: boolean = licenceRequired(),
): number {
  const fallback = hosted ? DEFAULT_HOSTED_ROOM_IDLE_HOURS : 0;
  const raw = env.SUITE_ROOM_IDLE_HOURS?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface ProjectionWorkerOptions {
  /** Sync server the worker joins, e.g. `ws://localhost:1234`. */
  url: string;
  /** Worker token that may write projection rooms only. */
  projectionToken: string;
  /** Worker token that may write a workspace room with an active editor share. */
  sourceToken: string;
  documents: Pick<DocumentStore, "load" | "delete">;
  shares: ProjectionWorkerShares;
  /** Quiet period before a saved workspace is rebuilt. */
  debounceMs?: number;
  /**
   * Hours a projection room may sit idle before the sweep revokes it; `0`
   * switches the sweep off. Defaults to `roomIdleHours()`, which is off on a
   * self-host and 24 hours on the hosted relay.
   */
  idleHours?: number;
  /**
   * Sessions in a room other than the worker's own, or `null` when the sync
   * server cannot be read. Wired to `roomSessionCount`; without it the sweep
   * never closes anything, because it cannot prove a room has no viewers.
   */
  roomClients?: (roomId: string) => number | null;
  /**
   * Called with a room id after the sweep has closed it and dropped its stored
   * documents. Wired to `forgetRoomDocument` so the sync server's in-memory copy
   * goes too — otherwise the sweep frees disk but not memory.
   */
  onRoomClosed?: (roomId: string) => void;
  /** Clock for idle accounting; tests replace it. */
  now?: () => number;
  logger?: Pick<Console, "warn">;
}

interface RoomState {
  roomId: string;
  shareId: string;
  workspaceId: string;
  role: ShareRole;
  target: ProjectionTarget;
  doc: LoroDoc;
  adaptor: LoroAdaptor;
  /** Wrapper kept for the life of the room so the target peer id stays stable. */
  workspace: WorkspaceDocument;
  room: LoroWebsocketClientRoom;
  /** Projection the draft was last written from; the base of a publish diff. */
  baseline: WorkspaceDocument | null;
  /** Version vector of `doc` when `baseline` was taken, as canonical JSON. */
  baselineVersion: string;
  /** True once an editor changed the draft after the last projection. */
  dirty: boolean;
  /** Last time an owner save, a publish, a reload or a status read touched it. */
  lastActiveAt: number;
}

/** The worker's writer connection to a real workspace room, used by publish. */
interface SourceRoom {
  workspaceId: string;
  doc: LoroDoc;
  adaptor: LoroAdaptor;
  workspace: WorkspaceDocument;
  room: LoroWebsocketClientRoom;
  /** Live connection state; a publish must not write into a dead room. */
  status: () => string;
}

interface PendingRebuild {
  timer: NodeJS.Timeout;
  promise: Promise<void>;
  resolve: () => void;
}

const DEFAULT_DEBOUNCE_MS = 200;
/** A brand-new room never reaches a server version, so cap the wait. */
const JOIN_SETTLE_MS = 1000;
const SOURCE_JOIN_WAIT_MS = 2000;
const SOURCE_JOIN_POLL_MS = 50;
/** Cap the post-publish wait for the source room; the write is already local. */
const SOURCE_FLUSH_MS = 200;
/** How long a publish waits for the editor's draft to reach the share room. */
const VERSION_GATE_MS = 2000;
const VERSION_POLL_MS = 25;
const encoder = new TextEncoder();

function isProjectionShare(share: Share): boolean {
  if (share.scope === "workspace" || share.roomId === null) return false;
  if (share.scope === "selection") return share.boardId !== null && share.cardIds.length > 0;
  return share.scope === "board" ? share.boardId !== null : share.cardId !== null;
}

function isLiveShare(share: Share): boolean {
  return share.revokedAt === null && (share.expiresAt === null || share.expiresAt > Date.now());
}

function deleteRoomDocuments(documents: Pick<DocumentStore, "delete">, roomId: string): void {
  for (const key of loroDocumentKeys(roomId)) {
    try {
      documents.delete(key);
    } catch {
      // A missing/legacy key is already gone; deletion is best-effort cleanup.
    }
  }
}

/**
 * The slice of the patched sync server `roomSessionCount` reads: the socket set
 * and the per-socket session records. `loro-websocket` keeps both private and
 * the patch adds no getter, so the shape is declared here rather than imported;
 * the same internals back `disconnectRoomWhere` in `roomSockets.ts`.
 */
interface SyncServerSessions {
  wss?: { clients?: Iterable<unknown> };
  clients?: {
    get(socket: unknown): { rooms?: Iterable<string>; auths?: Map<string, string> } | undefined;
  };
}

/**
 * The patched sync server's room table, keyed `<roomId>:<crdtType>`. Upstream
 * keeps it private and never removes an entry, so this module reaches into it
 * the same way `roomSessionCount` reaches into the session maps.
 */
interface SyncServerRooms {
  rooms?: Map<string, unknown>;
}

/**
 * Drops the sync server's in-memory copy of a room that no longer has a share.
 *
 * `SimpleServer` keeps one room document per room for the life of the process,
 * even after the last session leaves; for a projection room that is a full
 * document copy per dead link, which is the memory the idle sweep exists to
 * free. Only call this once the room has no sessions and its link is revoked: a
 * document dropped while somebody can still join would be rebuilt from the
 * store, which the revoke just emptied.
 */
export function forgetRoomDocument(server: unknown, roomId: string): boolean {
  const rooms = (server as SyncServerRooms | null)?.rooms;
  if (!(rooms instanceof Map)) return false;
  const names = new Set([roomId, `${roomId}:presence`, `${roomId}:cursors`]);
  let dropped = false;
  for (const key of [...rooms.keys()]) {
    const split = key.lastIndexOf(":");
    const name = split === -1 ? key : key.slice(0, split);
    if (!names.has(name)) continue;
    rooms.delete(key);
    dropped = true;
  }
  return dropped;
}

/**
 * Sessions in one share room other than the worker's own, or `null` when the
 * sync server cannot be read.
 *
 * A room key is `<roomId>:<crdtType>`; the derived presence and cursor rooms
 * count too, because a browser that only opened presence is still looking at
 * the link. One socket is one session however many rooms it joined.
 */
export function roomSessionCount(
  server: unknown,
  roomId: string,
  workerToken: string,
): number | null {
  const internals = server as SyncServerSessions | null;
  const sockets = internals?.wss?.clients;
  const clients = internals?.clients;
  if (!sockets || !clients || typeof clients.get !== "function") return null;

  const names = new Set([roomId, `${roomId}:presence`, `${roomId}:cursors`]);
  let sessions = 0;
  for (const socket of sockets) {
    const client = clients.get(socket);
    if (!client?.rooms || !client.auths) continue;
    for (const key of client.rooms) {
      const split = key.lastIndexOf(":");
      const name = split === -1 ? key : key.slice(0, split);
      if (!names.has(name)) continue;
      // The worker holds every projection room it projects; anybody else is a
      // reader the sweep must not close the room under.
      if ((client.auths.get(key) ?? "") !== workerToken) {
        sessions += 1;
        break;
      }
    }
  }
  return sessions;
}

function targetOf(share: Share): ProjectionTarget | null {
  if (share.scope === "board") {
    return share.boardId ? { scope: "board", boardId: share.boardId } : null;
  }
  if (share.scope === "card") {
    return share.cardId ? { scope: "card", cardId: share.cardId } : null;
  }
  if (share.scope === "selection") {
    return share.boardId && share.cardIds.length > 0
      ? { scope: "selection", boardId: share.boardId, cardIds: share.cardIds }
      : null;
  }
  return null;
}

/**
 * Narrows a target to what a publish may write. A selection share is
 * viewer-only, so reaching this with one is a bug the caller already refused.
 */
function publishTarget(target: ProjectionTarget): PublishTarget {
  if (target.scope === "selection") throw new Error("Selection links are read-only.");
  return target;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Canonical form of a version vector, so two documents compare by value. */
function versionJson(doc: LoroDoc): string {
  const entries = [...doc.version().toJSON()].map(
    ([peer, counter]) => [String(peer), counter] as const,
  );
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(entries);
}

function failure(reason: string): SharePublishResult {
  return { ok: false, conflicts: [], unsupported: [], reason };
}

/** Why a share cannot publish, or null when it may. */
function publishProblem(share: Share): string | null {
  if (share.revokedAt !== null) return "This share was revoked.";
  if (share.scope === "workspace") return "Workspace shares do not publish.";
  // The API only creates viewer selection links; a hand-written editor row
  // still must not publish into the workspace it is a subset of.
  if (share.scope === "selection") return "Selection links are read-only.";
  if (share.role !== "editor") return "This link is read-only.";
  if (!share.roomId) return "This share has no room.";
  return null;
}

/** Resolves when the work settles, or after `ms`, so a stale room cannot block. */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    void work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/**
 * Keeps every board, card and selection share room in sync with the workspace
 * it projects.
 *
 * Each share room gets one long-lived `LoroDoc` held by this worker; rebuilds
 * write into that document, so the worker peer keeps winning the last-write-wins
 * race for the values it replaces. Board, card and selection shares are
 * read-only views, so the worker is the only writer such a room sees.
 */
export class ProjectionWorker {
  private readonly options: ProjectionWorkerOptions;
  private readonly debounceMs: number;
  private client: LoroWebsocketClient | null = null;
  private readonly rooms = new Map<string, RoomState>();
  private readonly sources = new Map<string, SourceRoom>();
  private readonly openingSources = new Map<string, Promise<SourceRoom | null>>();
  private readonly pending = new Map<string, PendingRebuild>();
  private readonly queues = new Map<string, Promise<void>>();
  private started = false;
  /** Tail of the sweep chain, so two operator calls never interleave. */
  private sweeping: Promise<void> = Promise.resolve();

  constructor(options: ProjectionWorkerOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Clock for idle accounting; a test can freeze or advance it. */
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Records that something used the room, so the idle window restarts. */
  private touch(room: RoomState): void {
    room.lastActiveAt = this.now();
  }

  /** Joins every active board, card and selection share room and publishes their projections. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const client = new LoroWebsocketClient({
      url: this.options.url,
      onError: (error) => this.warn(`client error: ${error.message}`),
    });
    this.client = client;

    try {
      await client.waitConnected();
    } catch (error) {
      this.warn(`could not connect to ${this.options.url}: ${message(error)}`);
      return;
    }

    const workspaces = new Set<string>();
    for (const share of this.options.shares.listAllActive()) {
      if (isProjectionShare(share)) workspaces.add(share.workspaceId);
    }
    for (const workspaceId of workspaces) await this.run(workspaceId);
  }

  /**
   * Rebuilds the projections of one workspace after a save. Callers may ask for
   * an immediate rebuild (a share was created or revoked); otherwise bursts of
   * saves coalesce into one pass.
   */
  schedule(workspaceId: string, options: { immediate?: boolean } = {}): Promise<void> {
    if (!this.started || workspaceId.length === 0) return Promise.resolve();

    const pending = this.pending.get(workspaceId);
    if (options.immediate) {
      if (!pending) return this.run(workspaceId);
      // The immediate rebuild replaces the queued one.
      clearTimeout(pending.timer);
      this.pending.delete(workspaceId);
      const run = this.run(workspaceId);
      void run.then(() => pending.resolve());
      return run;
    }

    if (pending) {
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => this.fire(workspaceId), this.debounceMs);
      pending.timer.unref?.();
      return pending.promise;
    }

    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const timer = setTimeout(() => this.fire(workspaceId), this.debounceMs);
    timer.unref?.();
    this.pending.set(workspaceId, { timer, promise, resolve });
    return promise;
  }

  /** Leaves every room (source room included) and closes the client. */
  async stop(): Promise<void> {
    this.started = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
    this.pending.clear();

    await Promise.allSettled([...this.queues.values(), ...this.openingSources.values()]);
    this.queues.clear();
    this.openingSources.clear();

    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    for (const room of rooms) await this.closeRoom(room);

    const sources = [...this.sources.keys()];
    for (const workspaceId of sources) await this.closeSource(workspaceId);

    this.client?.close();
    this.client = null;
  }

  /** Rooms the worker currently holds, for tests and diagnostics. */
  roomIds(): string[] {
    return [...this.rooms.keys()];
  }

  /** Workspaces with a live source-room writer, for tests and diagnostics. */
  sourceIds(): string[] {
    return [...this.sources.keys()];
  }

  /** Connection state of a workspace's source room, for tests and diagnostics. */
  sourceStatus(workspaceId: string): string | null {
    return this.sources.get(workspaceId)?.status() ?? null;
  }

  /**
   * Publishes an editor's draft into its workspace. The share room, its source
   * room and a baseline are all required: a publish never falls back to saved
   * bytes, because those may lag the owner's live edits.
   *
   * `overwrite` names the conflicting keys whose draft value wins. An empty
   * array is meaningful: it keeps every workspace value.
   */
  publish(
    share: Share,
    version?: ShareVersion,
    overwrite?: readonly string[],
  ): Promise<SharePublishResult> {
    if (!this.started) return Promise.resolve(failure("The share service is not running."));
    return this.enqueue(share.workspaceId, () => this.publishNow(share, version, overwrite)).catch(
      (error: unknown) => failure(message(error)),
    );
  }

  /**
   * Reports whether a share's draft differs from its baseline. A room that is
   * not open yet is joined first, so the answer is about the draft, not about
   * which shares happen to be warm.
   */
  status(share: Share): Promise<ShareStatus> {
    const idle: ShareStatus = { dirty: false, hasBaseline: false };
    if (!this.started) return Promise.resolve(idle);
    return this.enqueue(share.workspaceId, () => this.statusNow(share)).catch((error: unknown) => {
      this.warn(`could not read the status of ${share.id}: ${message(error)}`);
      return idle;
    });
  }

  /** Discards an editor's draft and rebuilds it from the workspace. */
  reload(share: Share): Promise<SharePublishResult> {
    if (!this.started) return Promise.resolve(failure("The share service is not running."));
    return this.enqueue(share.workspaceId, () => this.reloadNow(share)).catch((error: unknown) =>
      failure(message(error)),
    );
  }

  private fire(workspaceId: string): void {
    const pending = this.pending.get(workspaceId);
    this.pending.delete(workspaceId);
    void this.run(workspaceId).then(() => pending?.resolve());
  }

  /**
   * Serializes work per workspace so two saves, or a save and a publish, cannot
   * interleave writes. Every task runs even when the task before it failed.
   */
  private enqueue<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      (error: unknown) => this.warn(`work for ${workspaceId} failed: ${message(error)}`),
    );
    this.queues.set(workspaceId, settled);
    void settled.then(() => {
      if (this.queues.get(workspaceId) === settled) this.queues.delete(workspaceId);
    });
    return next;
  }

  /** Serializes rebuilds per workspace so two saves cannot interleave writes. */
  private run(workspaceId: string): Promise<void> {
    return this.enqueue(workspaceId, () => this.refresh(workspaceId));
  }

  private async refresh(workspaceId: string): Promise<void> {
    if (!this.started) return;
    await this.syncRooms(workspaceId);

    const rooms = [...this.rooms.values()].filter((room) => room.workspaceId === workspaceId);
    if (rooms.length === 0) return;

    const source = this.loadSource(workspaceId);
    // A workspace that was never saved is rebuilt from scratch on the next save.
    if (!source) return;

    for (const room of rooms) this.project(source, room);
  }

  /** Opens rooms for new shares and closes the ones that were revoked. */
  private async syncRooms(workspaceId: string): Promise<void> {
    const wanted = new Map<string, Share>();
    for (const share of this.options.shares.list(workspaceId)) {
      if (isProjectionShare(share) && share.roomId && isLiveShare(share)) {
        wanted.set(share.roomId, share);
      }
    }

    for (const [roomId, room] of [...this.rooms]) {
      if (room.workspaceId !== workspaceId) continue;
      if (wanted.has(roomId)) continue;
      this.rooms.delete(roomId);
      await this.closeRoom(room);
      // The share was revoked or expired; its projected copy and draft baseline
      // have no reader, so do not leave them on disk.
      deleteRoomDocuments(this.options.documents, roomId);
      try {
        this.options.shares.deleteBaseline(room.shareId);
      } catch (error) {
        this.warn(`could not drop the baseline for ${room.shareId}: ${message(error)}`);
      }
    }

    for (const [roomId, share] of wanted) {
      if (this.rooms.has(roomId)) continue;
      await this.openRoom(share);
    }

    // Only a workspace with an editor share needs a writer connection: viewers
    // are served from the saved bytes, and a publish must see live owner state.
    const hasEditor = [...wanted.values()].some((share) => share.role === "editor");
    if (hasEditor) await this.ensureSource(workspaceId);
    else await this.closeSource(workspaceId);
  }

  private async openRoom(share: Share): Promise<void> {
    const client = this.client;
    const roomId = share.roomId;
    const target = targetOf(share);
    if (!client || !roomId || !target) return;

    const doc = new LoroDoc();
    this.seed(doc, roomId);
    const adaptor = new LoroAdaptor(doc);

    try {
      const room = await client.join({
        roomId,
        crdtAdaptor: adaptor,
        auth: () => encoder.encode(this.options.projectionToken),
      });
      // Wait for the room's stored state, but never for a room that has none.
      await settleWithin(room.waitForReachingServerVersion(), JOIN_SETTLE_MS);
      if (!this.started) {
        await room.leave().catch(() => undefined);
        adaptor.destroy();
        return;
      }

      const baseline = this.loadBaseline(share.id);
      const state: RoomState = {
        roomId,
        shareId: share.id,
        workspaceId: share.workspaceId,
        role: share.role,
        target,
        doc,
        adaptor,
        workspace: new WorkspaceDocument(doc),
        room,
        baseline,
        baselineVersion: baseline ? versionJson(baseline.doc) : "",
        dirty: false,
        lastActiveAt: this.now(),
      };
      // A draft that survived a restart is still the editor's until it is
      // published or reloaded. The version vector cannot answer that on its own:
      // a projection written after the baseline was persisted advances the room
      // history without changing a value, so compare the allowed content.
      state.dirty =
        share.role === "editor" &&
        baseline !== null &&
        this.draftDiffers(state.workspace, baseline, target);
      this.watchDraft(state);
      this.rooms.set(roomId, state);
    } catch (error) {
      adaptor.destroy();
      this.warn(`could not join ${roomId}: ${message(error)}`);
    }
  }

  /**
   * Whether the draft's allowed content differs from the baseline. A restarted
   * worker cannot use the version vector for this: the server may have applied a
   * projection after the baseline was persisted, which advances the history
   * without changing a value. Only real draft edits should pause projection.
   */
  private draftDiffers(
    draft: WorkspaceDocument,
    baseline: WorkspaceDocument,
    target: ProjectionTarget,
  ): boolean {
    try {
      return planPublish(draft, baseline, baseline, publishTarget(target)).changes.length > 0;
    } catch (error) {
      // Comparing must never freeze a room; a broken comparison reads as clean.
      this.warn(`could not compare a draft with its baseline: ${message(error)}`);
      return false;
    }
  }

  /**
   * Marks an editor room dirty when a change arrives that did not come from the
   * projection. The origin alone is not enough: a remote editor's import may
   * carry any origin, so the current version is compared with the baseline too.
   */
  private watchDraft(room: RoomState): void {
    if (room.role !== "editor") return;
    room.doc.subscribe((batch) => {
      if (batch.origin === PROJECTION_APPLY_ORIGIN) return;
      if (room.dirty) return;
      if (versionJson(room.doc) === room.baselineVersion) return;
      room.dirty = true;
    });
  }

  private async closeRoom(room: RoomState): Promise<void> {
    await room.room.leave().catch(() => undefined);
    room.adaptor.destroy();
  }

  /**
   * Seeds the room document from what the server last saved. Its history gives
   * the worker's first rebuild a lamport clock above every earlier projection,
   * so the rewrite wins instead of losing to a stale op.
   */
  private seed(doc: LoroDoc, roomId: string): void {
    const state = loadLoroDocument(this.options.documents, roomId);
    if (!state) return;
    try {
      doc.import(state);
    } catch (error) {
      this.warn(`ignoring unreadable projection state for ${roomId}: ${message(error)}`);
    }
  }

  private documentFrom(snapshot: Uint8Array): WorkspaceDocument | null {
    const doc = new LoroDoc();
    try {
      doc.import(snapshot);
    } catch (error) {
      this.warn(`ignoring unreadable snapshot: ${message(error)}`);
      return null;
    }
    return new WorkspaceDocument(doc);
  }

  private loadBaseline(shareId: string): WorkspaceDocument | null {
    let snapshot: Uint8Array | null = null;
    try {
      snapshot = this.options.shares.getBaseline(shareId);
    } catch (error) {
      this.warn(`could not read the baseline for ${shareId}: ${message(error)}`);
      return null;
    }
    return snapshot ? this.documentFrom(snapshot) : null;
  }

  /** Persists the projection just written and makes it the draft's base. */
  private captureBaseline(room: RoomState): void {
    const snapshot = room.doc.export({ mode: "snapshot" });
    try {
      this.options.shares.setBaseline(room.shareId, snapshot);
    } catch (error) {
      this.warn(`could not persist the baseline for ${room.shareId}: ${message(error)}`);
    }
    room.baseline = this.documentFrom(snapshot);
    room.baselineVersion = versionJson(room.doc);
    room.dirty = false;
  }

  /**
   * Loads a workspace for projection: the live source room when the workspace
   * has editor shares, otherwise the last saved bytes.
   */
  private loadSource(workspaceId: string): WorkspaceDocument | null {
    const live = this.sources.get(workspaceId);
    if (live) return live.workspace;

    const state = loadLoroDocument(this.options.documents, workspaceId);
    if (!state) return null;
    return this.documentFrom(state);
  }

  private ensureSource(workspaceId: string): Promise<SourceRoom | null> {
    const open = this.sources.get(workspaceId);
    if (open) return Promise.resolve(open);
    const pending = this.openingSources.get(workspaceId);
    if (pending) return pending;

    // Creation is serialized per workspace: two saves racing to open the writer
    // would otherwise join the room twice.
    const task = this.openSource(workspaceId).then((source) => {
      if (this.openingSources.get(workspaceId) === task) {
        this.openingSources.delete(workspaceId);
      }
      if (source && this.started) this.sources.set(workspaceId, source);
      return source;
    });
    this.openingSources.set(workspaceId, task);
    return task;
  }

  private async openSource(workspaceId: string): Promise<SourceRoom | null> {
    const client = this.client;
    if (!client) return null;

    const doc = new LoroDoc();
    const state = loadLoroDocument(this.options.documents, workspaceId);
    if (state) {
      try {
        doc.import(state);
      } catch (error) {
        this.warn(`ignoring unreadable workspace state for ${workspaceId}: ${message(error)}`);
      }
    }

    const adaptor = new LoroAdaptor(doc);
    let status: string = RoomJoinStatus.Connecting;
    try {
      const room = await client.join({
        roomId: workspaceId,
        crdtAdaptor: adaptor,
        auth: () => encoder.encode(this.options.sourceToken),
        onStatusChange: (next) => {
          status = next;
        },
      });
      // Bounded: a workspace room that has never been saved has no version.
      await settleWithin(room.waitForReachingServerVersion(), JOIN_SETTLE_MS);
      if (!this.started) {
        await room.leave().catch(() => undefined);
        adaptor.destroy();
        return null;
      }
      return {
        workspaceId,
        doc,
        adaptor,
        workspace: new WorkspaceDocument(doc),
        room,
        status: () => status,
      };
    } catch (error) {
      adaptor.destroy();
      this.warn(`could not join workspace ${workspaceId}: ${message(error)}`);
      return null;
    }
  }

  private async closeSource(workspaceId: string): Promise<void> {
    const source = this.sources.get(workspaceId);
    if (!source) return;
    this.sources.delete(workspaceId);
    await source.room.leave().catch(() => undefined);
    source.adaptor.destroy();
  }

  private project(source: WorkspaceDocument, room: RoomState): void {
    // An owner save is activity even when the rebuild is held back: the room is
    // still the one this workspace projects into.
    this.touch(room);
    // A dirty draft belongs to the editor: an owner save must not overwrite it.
    if (room.dirty) return;
    try {
      this.reproject(source, room);
    } catch (error) {
      // A trashed or deleted card has nothing to publish; keep the last good
      // projection rather than emptying a share the viewer may be reading.
      this.warn(`projection for ${room.shareId} skipped: ${message(error)}`);
    }
  }

  /** Rebuilds the projection and resets the draft's baseline. */
  private reproject(source: WorkspaceDocument, room: RoomState): void {
    const projection = projectWorkspace(source, room.target);
    applyProjection(room.workspace, projection.workspace);
    // Viewers never publish; only an editor draft needs a baseline snapshot.
    if (room.role === "editor") this.captureBaseline(room);
  }

  private async prepareDraft(
    share: Share,
  ): Promise<{ room: RoomState; source: SourceRoom } | SharePublishResult> {
    const problem = publishProblem(share);
    if (problem) return failure(problem);
    const roomId = share.roomId as string;

    // A share created since the last refresh has no room yet.
    if (!this.rooms.has(roomId)) await this.syncRooms(share.workspaceId);
    const room = this.rooms.get(roomId);
    if (!room) return failure("The share room is not open.");
    if (room.role !== "editor") return failure("This link is read-only.");

    if (!room.baseline) {
      const baseline = this.loadBaseline(room.shareId);
      if (baseline) {
        room.baseline = baseline;
        room.baselineVersion = versionJson(baseline.doc);
      }
    }

    // A publish must see the owner's live state; saved bytes are not good enough.
    const source = await this.ensureSource(share.workspaceId);
    if (!source) return failure("The workspace is not reachable right now; try again.");
    if (source.status() !== RoomJoinStatus.Joined && !(await this.waitForSource(source))) {
      this.warn(`source ${share.workspaceId} is ${source.status()} for share ${share.id}`);
      return failure("The workspace connection is not available right now; try again.");
    }
    return { room, source };
  }

  /**
   * Reads, and if needed opens, the room behind a share. A viewer or a share
   * without a room has no draft to report.
   */
  private async statusNow(share: Share): Promise<ShareStatus> {
    const idle: ShareStatus = { dirty: false, hasBaseline: false };
    if (share.role !== "editor" || share.scope === "workspace" || !share.roomId) return idle;
    const roomId = share.roomId;

    // A share created since the last refresh has no room yet.
    if (!this.rooms.has(roomId)) await this.syncRooms(share.workspaceId);
    const room = this.rooms.get(roomId);
    if (!room) return idle;
    this.touch(room);

    if (!room.baseline) {
      const baseline = this.loadBaseline(room.shareId);
      if (baseline) {
        room.baseline = baseline;
        room.baselineVersion = versionJson(baseline.doc);
        room.dirty = this.draftDiffers(room.workspace, baseline, room.target);
      }
    }
    return { dirty: room.role === "editor" && room.dirty, hasBaseline: room.baseline !== null };
  }

  private async publishNow(
    share: Share,
    version?: ShareVersion,
    overwrite?: readonly string[],
  ): Promise<SharePublishResult> {
    const prepared = await this.prepareDraft(share);
    if ("ok" in prepared) return prepared;
    const { room, source } = prepared;
    this.touch(room);
    const baseline = room.baseline;
    if (!baseline) return failure("This share has no baseline yet; reload it from the workspace.");

    if (version) {
      const target = this.versionVector(version);
      if (!target) return failure("The publish version is malformed.");
      // The editor's write travels over the sync socket, the publish over HTTP.
      // Without this gate a fast click publishes the room before that write
      // lands, and the rebuild puts the old value back.
      if (!(await this.waitForVersion(room, target))) {
        return failure("The draft is still syncing; publish again in a moment.");
      }
    }

    // An absent list keeps the old all-or-nothing policy; an empty list is a
    // decision to keep every workspace value.
    const plan = planPublish(
      room.workspace,
      baseline,
      source.workspace,
      publishTarget(room.target),
      overwrite === undefined ? undefined : { overwrite: new Set(overwrite) },
    );
    if (plan.conflicts.length > 0 || plan.unsupported.length > 0) {
      return { ok: false, conflicts: plan.conflicts, unsupported: plan.unsupported };
    }

    const applied = applyPublish(source.workspace, room.workspace, plan);
    await settleWithin(source.room.waitForReachingServerVersion(), SOURCE_FLUSH_MS);

    try {
      this.reproject(source.workspace, room);
    } catch (error) {
      // The publish landed; the view just cannot be rebuilt (e.g. the card was
      // trashed in the workspace). Keep the draft as the new baseline so the
      // editor is not stuck dirty.
      this.warn(`could not rebuild ${room.shareId} after publish: ${message(error)}`);
      this.captureBaseline(room);
    }
    return { ok: true, applied };
  }

  private async reloadNow(share: Share): Promise<SharePublishResult> {
    const prepared = await this.prepareDraft(share);
    if ("ok" in prepared) return prepared;
    const { room, source } = prepared;
    this.touch(room);

    // Count what the discard drops, so the caller can report it.
    let discarded = 0;
    if (room.baseline) {
      discarded = planPublish(
        room.workspace,
        room.baseline,
        room.baseline,
        publishTarget(room.target),
      ).changes.length;
    }

    try {
      this.reproject(source.workspace, room);
    } catch (error) {
      this.warn(`could not reload ${room.shareId}: ${message(error)}`);
      return failure("The workspace has nothing to show for this share right now.");
    }
    return { ok: true, applied: discarded };
  }

  private versionVector(version: ShareVersion): VersionVector | null {
    try {
      return VersionVector.parseJSON(new Map(Object.entries(version)) as Map<`${number}`, number>);
    } catch (error) {
      this.warn(`ignoring a malformed publish version: ${message(error)}`);
      return null;
    }
  }

  /** Polls the share room until its version includes `target`, or gives up. */
  /** A source room may still be joining when a publish arrives; give it a beat. */
  private async waitForSource(source: SourceRoom): Promise<boolean> {
    const deadline = Date.now() + SOURCE_JOIN_WAIT_MS;
    while (Date.now() < deadline) {
      if (source.status() === RoomJoinStatus.Joined) return true;
      await delay(SOURCE_JOIN_POLL_MS);
    }
    return source.status() === RoomJoinStatus.Joined;
  }

  private async waitForVersion(room: RoomState, target: VersionVector): Promise<boolean> {
    const deadline = Date.now() + VERSION_GATE_MS;
    for (;;) {
      const comparison = room.doc.version().compare(target);
      if (comparison !== undefined && comparison >= 0) return true;
      if (Date.now() >= deadline) return false;
      await delay(VERSION_POLL_MS);
    }
  }

  private warn(text: string): void {
    (this.options.logger ?? console).warn(`[projection] ${text}`);
  }

  /**
   * The projection rooms this worker currently holds. `loro-websocket` cannot
   * enumerate rooms, so this is the only complete answer to "which share rooms
   * are live, and whose are they"; read-only and safe while rooms are opening.
   */
  projectionRooms(): ProjectionRoomInfo[] {
    return [...this.rooms.values()].map((room) => ({
      roomId: room.roomId,
      shareId: room.shareId,
      workspaceId: room.workspaceId,
      role: room.role,
      hasBaseline: room.baseline !== null,
      dirty: room.dirty,
    }));
  }

  /**
   * Revokes the links of projection rooms nobody has used for the idle window.
   *
   * A room qualifies when no owner save, publish, reload or status read has
   * touched it for `idleHours` **and** the sync server reports no session in it
   * other than the worker's own. Closing reuses the revoke path every other
   * revoke takes: the link is revoked through the share store, then the next
   * `syncRooms` pass leaves the room and drops its documents and baseline.
   *
   * A room whose sessions cannot be read is kept, and a `dryRun` reports the
   * candidates without touching them. With `idleHours` at `0` — the self-host
   * default — this is a no-op that still says so in its report.
   */
  sweepIdle(options: { dryRun?: boolean } = {}): Promise<RoomSweepReport> {
    // Serialized: two operator calls must not revoke, then race the cleanup.
    const next = this.sweeping.then(
      () => this.sweepNow(options.dryRun === true),
      () => this.sweepNow(options.dryRun === true),
    );
    this.sweeping = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async sweepNow(dryRun: boolean): Promise<RoomSweepReport> {
    const idleHours = this.options.idleHours ?? roomIdleHours();
    const report: RoomSweepReport = { idleHours, dryRun, checked: 0, unknown: 0, rooms: [] };
    if (!this.started || idleHours <= 0) return report;

    const now = this.now();
    const idleMs = idleHours * HOUR_MS;
    const candidates: RoomState[] = [];
    for (const room of this.rooms.values()) {
      report.checked += 1;
      if (now - room.lastActiveAt < idleMs) continue;
      const sessions = this.options.roomClients?.(room.roomId) ?? null;
      if (sessions === null) {
        // No reader, or a server that cannot answer: never close blind.
        report.unknown += 1;
        continue;
      }
      if (sessions > 0) continue;
      candidates.push(room);
    }
    if (candidates.length === 0) return report;
    if (dryRun) {
      report.rooms = candidates.map((room) => sweptRoom(room, now));
      return report;
    }
    if (!this.options.shares.revoke) {
      this.warn("the room sweep needs a share store that can revoke links");
      return report;
    }
    const revoke = this.options.shares.revoke;

    // One rebuild per workspace closes every room it lost and deletes their
    // documents and baselines; that is the same cleanup a revoke always runs.
    const byWorkspace = new Map<string, RoomState[]>();
    for (const room of candidates) {
      const rooms = byWorkspace.get(room.workspaceId) ?? [];
      rooms.push(room);
      byWorkspace.set(room.workspaceId, rooms);
    }
    for (const [workspaceId, rooms] of byWorkspace) {
      for (const room of rooms) {
        try {
          revoke(room.shareId);
        } catch (error) {
          this.warn(`could not revoke the idle share ${room.shareId}: ${message(error)}`);
        }
      }
      await this.enqueue(workspaceId, () => this.syncRooms(workspaceId));
      for (const room of rooms) {
        if (this.rooms.has(room.roomId)) continue;
        report.rooms.push(sweptRoom(room, now));
        try {
          this.options.onRoomClosed?.(room.roomId);
        } catch (error) {
          this.warn(`could not forget the room ${room.roomId}: ${message(error)}`);
        }
      }
    }
    if (report.rooms.length > 0) {
      this.warn(`swept ${report.rooms.length} idle projection room(s) older than ${idleHours} h`);
    }
    return report;
  }
}

/** The operator-facing shape of one swept room. */
function sweptRoom(room: RoomState, now: number): SweptRoom {
  return {
    roomId: room.roomId,
    shareId: room.shareId,
    workspaceId: room.workspaceId,
    idleMs: Math.max(0, now - room.lastActiveAt),
  };
}
