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
type ProjectionTarget = { scope: "board"; boardId: string } | { scope: "card"; cardId: string };

export type ProjectionWorkerShares = Pick<
  ShareStore,
  "list" | "listAllActive" | "getBaseline" | "setBaseline" | "deleteBaseline"
>;

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
/** Cap the post-publish wait for the source room; the write is already local. */
const SOURCE_FLUSH_MS = 200;
/** How long a publish waits for the editor's draft to reach the share room. */
const VERSION_GATE_MS = 2000;
const VERSION_POLL_MS = 25;
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
  private readonly sources = new Map<string, SourceRoom>();
  private readonly openingSources = new Map<string, Promise<SourceRoom | null>>();
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

    this.client?.destroy();
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
      if (isProjectionShare(share) && share.roomId) wanted.set(share.roomId, share);
    }

    for (const [roomId, room] of [...this.rooms]) {
      if (room.workspaceId !== workspaceId) continue;
      if (wanted.has(roomId)) continue;
      this.rooms.delete(roomId);
      await this.closeRoom(room);
      // The share was revoked or lost its target; a draft baseline has no reader.
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
        auth: () => encoder.encode(this.options.internalToken),
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
      return planPublish(draft, baseline, baseline, target).changes.length > 0;
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
        auth: () => encoder.encode(this.options.internalToken),
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
    if (source.status() !== RoomJoinStatus.Joined) {
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
      room.target,
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

    // Count what the discard drops, so the caller can report it.
    let discarded = 0;
    if (room.baseline) {
      discarded = planPublish(room.workspace, room.baseline, room.baseline, room.target).changes
        .length;
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
}
