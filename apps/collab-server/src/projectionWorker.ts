import { applyProjection, projectWorkspace, WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc } from "loro-crdt";
import { CrdtType } from "loro-protocol";
import { LoroWebsocketClient, type LoroWebsocketClientRoom } from "loro-websocket";
import type { DocumentStore } from "./persistence.js";
import type { Share, ShareStore } from "./shares.js";

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
type ProjectionTarget = { scope: "board"; boardId: string } | { scope: "card"; cardId: string };

export type ProjectionWorkerShares = Pick<ShareStore, "list" | "listAllActive">;

export interface ProjectionWorkerOptions {
  /** Sync server the worker joins, e.g. `ws://localhost:1234`. */
  url: string;
  /** Internal token, which may write any room. */
  internalToken: string;
  documents: Pick<DocumentStore, "load">;
  shares: ProjectionWorkerShares;
  /** Quiet period before a saved workspace is rebuilt. */
  debounceMs?: number;
  logger?: Pick<Console, "warn">;
}

interface RoomState {
  roomId: string;
  shareId: string;
  workspaceId: string;
  target: ProjectionTarget;
  doc: LoroDoc;
  adaptor: LoroAdaptor;
  /** Wrapper kept for the life of the room so the target peer id stays stable. */
  workspace: WorkspaceDocument;
  room: LoroWebsocketClientRoom;
}

interface PendingRebuild {
  timer: NodeJS.Timeout;
  promise: Promise<void>;
  resolve: () => void;
}

const DEFAULT_DEBOUNCE_MS = 200;
/** A brand-new room never reaches a server version, so cap the wait. */
const JOIN_SETTLE_MS = 1000;
const encoder = new TextEncoder();

function isProjectionShare(share: Share): boolean {
  if (share.scope === "workspace" || share.roomId === null) return false;
  return share.scope === "board" ? share.boardId !== null : share.cardId !== null;
}

function targetOf(share: Share): ProjectionTarget | null {
  if (share.scope === "board") {
    return share.boardId ? { scope: "board", boardId: share.boardId } : null;
  }
  if (share.scope === "card") {
    return share.cardId ? { scope: "card", cardId: share.cardId } : null;
  }
  return null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
 * Keeps every board and card share room in sync with the workspace it projects.
 *
 * Each share room gets one long-lived `LoroDoc` held by this worker; rebuilds
 * write into that document, so the worker peer keeps winning the last-write-wins
 * race for the values it replaces. Board and card shares are read-only views, so
 * the worker is the only writer such a room sees.
 */
export class ProjectionWorker {
  private readonly options: ProjectionWorkerOptions;
  private readonly debounceMs: number;
  private client: LoroWebsocketClient | null = null;
  private readonly rooms = new Map<string, RoomState>();
  private readonly pending = new Map<string, PendingRebuild>();
  private readonly queues = new Map<string, Promise<void>>();
  private started = false;

  constructor(options: ProjectionWorkerOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Joins every active board and card share room and publishes their projections. */
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

  /** Leaves every room and closes the client. */
  async stop(): Promise<void> {
    this.started = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
    this.pending.clear();

    await Promise.allSettled([...this.queues.values()]);
    this.queues.clear();

    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    for (const room of rooms) await this.closeRoom(room);

    this.client?.destroy();
    this.client = null;
  }

  /** Rooms the worker currently holds, for tests and diagnostics. */
  roomIds(): string[] {
    return [...this.rooms.keys()];
  }

  private fire(workspaceId: string): void {
    const pending = this.pending.get(workspaceId);
    this.pending.delete(workspaceId);
    void this.run(workspaceId).then(() => pending?.resolve());
  }

  /** Serializes rebuilds per workspace so two saves cannot interleave writes. */
  private run(workspaceId: string): Promise<void> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.refresh(workspaceId))
      .catch((error: unknown) => this.warn(`rebuild of ${workspaceId} failed: ${message(error)}`));
    this.queues.set(workspaceId, next);
    void next.then(() => {
      if (this.queues.get(workspaceId) === next) this.queues.delete(workspaceId);
    });
    return next;
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
      if (isProjectionShare(share) && share.roomId) wanted.set(share.roomId, share);
    }

    for (const [roomId, room] of [...this.rooms]) {
      if (room.workspaceId !== workspaceId) continue;
      if (wanted.has(roomId)) continue;
      this.rooms.delete(roomId);
      await this.closeRoom(room);
    }

    for (const [roomId, share] of wanted) {
      if (this.rooms.has(roomId)) continue;
      await this.openRoom(share);
    }
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
        auth: () => encoder.encode(this.options.internalToken),
      });
      // Wait for the room's stored state, but never for a room that has none.
      await settleWithin(room.waitForReachingServerVersion(), JOIN_SETTLE_MS);
      if (!this.started) {
        await room.leave().catch(() => undefined);
        adaptor.destroy();
        return;
      }
      this.rooms.set(roomId, {
        roomId,
        shareId: share.id,
        workspaceId: share.workspaceId,
        target,
        doc,
        adaptor,
        workspace: new WorkspaceDocument(doc),
        room,
      });
    } catch (error) {
      adaptor.destroy();
      this.warn(`could not join ${roomId}: ${message(error)}`);
    }
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

  private loadSource(workspaceId: string): WorkspaceDocument | null {
    const state = loadLoroDocument(this.options.documents, workspaceId);
    if (!state) return null;
    const doc = new LoroDoc();
    try {
      doc.import(state);
    } catch (error) {
      this.warn(`ignoring unreadable workspace state for ${workspaceId}: ${message(error)}`);
      return null;
    }
    return new WorkspaceDocument(doc);
  }

  private project(source: WorkspaceDocument, room: RoomState): void {
    try {
      const projection = projectWorkspace(source, room.target);
      applyProjection(room.workspace, projection.workspace);
    } catch (error) {
      // A trashed or deleted card has nothing to publish; keep the last good
      // projection rather than emptying a share the viewer may be reading.
      this.warn(`projection for ${room.shareId} skipped: ${message(error)}`);
    }
  }

  private warn(text: string): void {
    (this.options.logger ?? console).warn(`[projection] ${text}`);
  }
}
