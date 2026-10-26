import { PROJECTION_APPLY_ORIGIN, WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc } from "loro-crdt";
import { LoroWebsocketClient, RoomJoinStatus } from "loro-websocket";
import { sumBy } from "remeda";
import type { Share } from "../store/shares.js";
import { RoomWorkBudget, roomOutstandingLimit } from "../sync/limits.js";
import { type DraftHost, draftStatus, publishDraft, reloadDraft } from "./apply.js";
import type {
  PendingRebuild,
  ProjectionRoomStats,
  ProjectionRun,
  ProjectionWorkerOptions,
  RoomState,
  SharePublishResult,
  ShareStatus,
  ShareVersion,
  SourceRoom,
} from "./model.js";
import {
  DEFAULT_DEBOUNCE_MS,
  encoder,
  isLiveShare,
  isProjectionShare,
  JOIN_SETTLE_MS,
  message,
  settleWithin,
  targetOf,
  versionJson,
} from "./model.js";
import type { ProjectionRoomInfo, RoomSweepReport } from "./rooms.js";
import {
  deleteRoomDocuments,
  loadLoroDocument,
  projectionBuildCap,
  projectionCardLimit,
  projectionRoomLimit,
  roomIdleHours,
} from "./rooms.js";
import {
  draftHasChanges,
  loadSourceDocument,
  persistBaseline,
  projectInto,
  readBaseline,
  reprojectInto,
  type SnapshotDeps,
  seedRoomDocument,
} from "./snapshot.js";
import { RoomSweeper } from "./sweep.js";

/**
 * Keeps every board, card and selection share room in sync with the workspace
 * it projects.
 *
 * Each share room gets one long-lived `LoroDoc` held by this worker; rebuilds
 * write into that document, so the worker peer keeps winning the last-write-wins
 * race for the values it replaces. Board, card and selection shares are
 * read-only views, so the worker is the only writer such a room sees.
 *
 * The rebuild step lives in `snapshot.ts` and the draft operations in
 * `apply.ts`; this class owns the rooms, the queues and the sweep.
 */
export class ProjectionWorker implements DraftHost {
  private readonly options: ProjectionWorkerOptions;
  private readonly debounceMs: number;
  private client: LoroWebsocketClient | null = null;
  private readonly rooms = new Map<string, RoomState>();
  private readonly sources = new Map<string, SourceRoom>();
  private readonly openingSources = new Map<string, Promise<SourceRoom | null>>();
  private readonly pending = new Map<string, PendingRebuild>();
  private readonly queues = new Map<string, Promise<void>>();
  private started = false;
  /** Ceiling on open projection rooms, read once so the gauge has one truth. */
  private readonly maxRooms: number;
  /** Rooms opened since `start()`; the boot cost divides nothing else. */
  private opened = 0;
  private evicted = 0;
  private refused = 0;
  /** Joins in flight, counted against the ceiling so concurrent opens cannot race past it. */
  private opening = 0;
  /** Rebuild outcomes since `start()`, for the operator inventory. */
  private skipped = 0;
  private capped = 0;
  private backpressured = 0;
  private coalesced = 0;
  private maxBuildMs = 0;
  /** Outstanding work per workspace: what keeps one board from queuing forever. */
  private readonly budget: RoomWorkBudget;
  /** A rebuild already queued for a workspace, so a second request joins it. */
  private readonly queuedRebuilds = new Map<string, Promise<void>>();

  constructor(options: ProjectionWorkerOptions) {
    this.options = options;
    // One bundle for both steps; the maps are live, so a room opened later is
    // visible without rebuilding it.
    this.sweeper = new RoomSweeper({
      isStarted: () => this.started,
      now: () => this.now(),
      idleHours: () => options.idleHours ?? roomIdleHours(),
      rooms: () => this.rooms.values(),
      roomClients: (roomId) => this.options.roomClients?.(roomId) ?? null,
      canRevokeShares: () => options.shares.revoke !== undefined,
      revokeShare: (shareId) => options.shares.revoke?.(shareId),
      enqueue: (workspaceId, work) => this.enqueue(workspaceId, work),
      reconcileRooms: (workspaceId) => this.reconcileRooms(workspaceId),
      hasRoom: (roomId) => this.rooms.has(roomId),
      forgetRoom: (roomId) => this.options.onRoomClosed?.(roomId),
      warn: (text) => this.warn(text),
    });
    this.snapshotDeps = {
      documents: options.documents,
      shares: options.shares,
      sources: this.sources,
      touch: (room) => this.touch(room),
      warn: (text) => this.warn(text),
      now: () => this.now(),
      maxCards: options.maxCards ?? projectionCardLimit(),
      buildCapMs: options.buildCapMs ?? projectionBuildCap(),
      report: (run) => this.note(run),
    };
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxRooms = options.maxRooms ?? projectionRoomLimit();
    this.budget = new RoomWorkBudget(options.outstanding ?? roomOutstandingLimit());
  }

  /**
   * Counts one rebuild outcome. The worker owns the numbers an operator reads in
   * `/api/admin/status`; `onRun` lets the server count the same event once into
   * the process metrics, so the two can never describe different runs.
   */
  private note(run: ProjectionRun): void {
    if (run.kind === "skipped") this.skipped += 1;
    if (run.kind === "capped") this.capped += 1;
    if (run.kind === "refused") this.backpressured += 1;
    if (run.kind === "rebuilt" || run.kind === "capped") {
      this.maxBuildMs = Math.max(this.maxBuildMs, run.buildMs);
    }
    this.options.onRun?.(run);
  }

  /**
   * Publishes an editor's draft into its workspace. The queue, the room and the
   * baseline belong to this worker; the planning lives in `apply.ts`.
   */
  publish(
    share: Share,
    version?: ShareVersion,
    overwrite?: readonly string[],
  ): Promise<SharePublishResult> {
    return publishDraft(this, share, version, overwrite);
  }

  /** Whether the share's draft still holds unpublished changes. */
  status(share: Share): Promise<ShareStatus> {
    return draftStatus(this, share);
  }

  /** Discards an editor's draft and rebuilds it from the workspace. */
  reload(share: Share): Promise<SharePublishResult> {
    return reloadDraft(this, share);
  }

  /**
   * The seam `DraftHost` sees: one bundle of the stores and the small callbacks
   * the rebuild and draft steps need, so neither has to know this class.
   */
  private readonly snapshotDeps: SnapshotDeps;
  private readonly sweeper: RoomSweeper;

  isStarted(): boolean {
    return this.started;
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  roomOf(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  captureBaseline(room: RoomState): void {
    persistBaseline(room, this.snapshotDeps);
  }

  reproject(source: WorkspaceDocument, room: RoomState): void {
    reprojectInto(source, room, this.snapshotDeps);
  }

  loadBaseline(shareId: string): WorkspaceDocument | null {
    return readBaseline(shareId, this.snapshotDeps);
  }

  draftDiffers(
    draft: WorkspaceDocument,
    baseline: WorkspaceDocument,
    target: RoomState["target"],
  ): boolean {
    return draftHasChanges(draft, baseline, target, (text) => this.warn(text));
  }

  /** Clock for idle accounting; a test can freeze or advance it. */
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Records that something used the room, so the idle window restarts. */
  touch(room: RoomState): void {
    room.lastActiveAt = this.now();
  }

  /**
   * Connects the worker and **opens no rooms**.
   *
   * A room is opened because somebody is looking at it (`openShare`) or because
   * it must be written (a publish, a status read), never because a share row
   * exists. The previous loop over `listAllActive()` loaded one document per
   * stored link: measured on this checkout, restarting a relay with 486 stored
   * links reached 6.5 GB RSS and was killed by the kernel before it could even
   * bind its health port. Boot now costs one socket.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.opened = 0;
    this.evicted = 0;
    this.refused = 0;

    const client = new LoroWebsocketClient({
      url: this.options.url,
      onError: (error) => this.warn(`client error: ${error.message}`),
    });
    this.client = client;

    try {
      await client.waitConnected();
    } catch (error) {
      this.warn(`could not connect to ${this.options.url}: ${message(error)}`);
    }
  }

  /**
   * Opens the projection room behind exactly this share, because somebody is
   * looking at it. This is the on-demand path the HTTP share resolve calls; the
   * room is projected from the freshest source available before this settles.
   *
   * A room that is already open is just touched: the idle window is about use,
   * and a second reader must not restart the join.
   */
  openShare(share: Share): Promise<void> {
    if (!this.started) return Promise.resolve();
    if (!isProjectionShare(share) || !share.roomId || !isLiveShare(share)) return Promise.resolve();
    const roomId = share.roomId;
    const open = this.rooms.get(roomId);
    if (open) {
      this.touch(open);
      return Promise.resolve();
    }
    // Serialized per workspace: two readers resolving the same link at once
    // must join once, and an open must not interleave with a rebuild.
    return this.enqueue(share.workspaceId, () => this.openRoomNow(share));
  }

  /**
   * Opens one share room and projects it. Called from inside the workspace
   * queue, so it must not enqueue again.
   */
  async openRoomNow(share: Share): Promise<void> {
    if (!this.started) return;
    const roomId = share.roomId;
    if (!roomId) return;
    const open = this.rooms.get(roomId);
    if (open) {
      this.touch(open);
      return;
    }

    const room = await this.createRoom(share);
    if (!room) return;
    // An editor room is written back to its workspace, so it needs the live
    // writer for a publish to see owner state. A viewer room is served from the
    // saved bytes, and loading the workspace document for it would be the very
    // eager cost this path exists to remove.
    if (share.role === "editor") await this.ensureSource(share.workspaceId);
    // A cold room holds whatever was last saved for it, which may lag the
    // owner's latest save. Project once so the reader sees the current board
    // rather than yesterday's copy, then keep following saves as before.
    const source = loadSourceDocument(share.workspaceId, this.snapshotDeps);
    if (source) projectInto(source, room, this.snapshotDeps);
  }

  /**
   * Joins a projection room if the ceiling allows it.
   *
   * Choice: **LRU eviction, refusing only when nothing may be evicted.**
   *
   * A pure refusal would deny the newest reader a live projection whenever the
   * relay is busy, and a live projection is what makes an open link follow the
   * owner's edits - so the busiest relay would be the one serving stale boards.
   * Evicting the least-recently-used room that has **no session attached** only
   * costs freshness for a link nobody is looking at; its document stays in the
   * store and is rebuilt the moment it is opened again. A room with a session
   * is never evicted, because dropping it would freeze what that reader is
   * looking at mid-view. When every room is attached, the open is refused and
   * counted: the reader still gets the saved projection, just not a live one.
   */
  private async createRoom(share: Share): Promise<RoomState | null> {
    if (this.rooms.size + this.opening >= this.maxRooms) {
      if (!(await this.evictLeastRecentlyUsed())) {
        this.refused += 1;
        this.warn(
          `refusing to open ${share.roomId as string}: the ${this.rooms.size} open projection ` +
            "room(s) are all attached to a reader or cannot be checked, so none may be closed " +
            `(SUITE_PROJECTION_ROOMS_MAX=${this.maxRooms})`,
        );
        return null;
      }
    }
    if (!this.started) return null;
    this.opening += 1;
    try {
      return await this.openRoom(share);
    } finally {
      this.opening -= 1;
    }
  }

  /** Closes the oldest open room no client is attached to; false when none is. */
  private async evictLeastRecentlyUsed(): Promise<boolean> {
    let victim: RoomState | null = null;
    for (const room of this.rooms.values()) {
      // `null` is "cannot tell", which is not proof that nobody is watching.
      if ((this.options.roomClients?.(room.roomId) ?? null) !== 0) continue;
      if (!victim || room.lastActiveAt < victim.lastActiveAt) victim = room;
    }
    if (!victim) return false;

    this.rooms.delete(victim.roomId);
    await this.closeRoom(victim);
    // The server keeps its own copy of every room for the life of the process;
    // dropping it is half the memory. The stored document is untouched, so the
    // next reader reloads and re-projects it.
    this.options.onRoomClosed?.(victim.roomId);
    this.evicted += 1;
    this.warn(
      `evicted projection room ${victim.roomId} (idle for ` +
        `${Math.max(0, this.now() - victim.lastActiveAt)} ms) to stay under ` +
        `${this.maxRooms} open rooms`,
    );
    return true;
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

  private fire(workspaceId: string): void {
    const pending = this.pending.get(workspaceId);
    this.pending.delete(workspaceId);
    void this.run(workspaceId).then(() => pending?.resolve());
  }

  /**
   * Serializes work per workspace so two saves, or a save and a publish, cannot
   * interleave writes. Every task runs even when the task before it failed.
   *
   * The queue is also where the per-room bound lives: the slot is taken when the
   * task is queued and released when it settles, so `run` can ask whether this
   * workspace already has its share of the process.
   */
  enqueue<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    this.budget.enter(workspaceId);
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      (error: unknown) => this.warn(`work for ${workspaceId} failed: ${message(error)}`),
    );
    this.queues.set(workspaceId, settled);
    void settled.then(() => {
      this.budget.leave(workspaceId);
      if (this.queues.get(workspaceId) === settled) this.queues.delete(workspaceId);
    });
    return next;
  }

  /**
   * Serializes rebuilds per workspace, and bounds them.
   *
   * Two rules, both about one board not spending the process on itself:
   *
   * - **Coalesce.** A rebuild reads the freshest source, so a request that
   *   arrives while one is already queued is satisfied by it. Without this, a
   *   board being dragged around during a slow rebuild queued one rebuild per
   *   save interval, and every one of them read the same final state.
   * - **Refuse past the bound.** When a workspace already holds
   *   `SUITE_ROOM_OUTSTANDING_MAX` tasks, the rebuild is refused and counted:
   *   freshness for one board is the cheapest thing to lose.
   */
  private run(workspaceId: string): Promise<void> {
    const queued = this.queuedRebuilds.get(workspaceId);
    if (queued) {
      // Not a refusal: the queued rebuild will read the state this request is
      // asking about, so the caller waits on that one.
      this.coalesced += 1;
      return queued;
    }
    if (this.budget.atLimit(workspaceId)) {
      this.note({
        kind: "refused",
        workspaceId,
        outstanding: this.budget.inFlight(workspaceId),
      });
      this.warn(
        `refusing a projection rebuild for ${workspaceId}: it already has ` +
          `${String(this.budget.inFlight(workspaceId))} task(s) outstanding ` +
          `(SUITE_ROOM_OUTSTANDING_MAX=${String(this.budget.limit)})`,
      );
      return Promise.resolve();
    }
    const promise = this.enqueue(workspaceId, () => this.refresh(workspaceId)).finally(() => {
      this.queuedRebuilds.delete(workspaceId);
    });
    this.queuedRebuilds.set(workspaceId, promise);
    return promise;
  }

  private async refresh(workspaceId: string): Promise<void> {
    if (!this.started) return;
    await this.reconcileRooms(workspaceId);

    const rooms = [...this.rooms.values()].filter((room) => room.workspaceId === workspaceId);
    if (rooms.length === 0) return;

    const source = loadSourceDocument(workspaceId, this.snapshotDeps);
    // A workspace that was never saved is rebuilt from scratch on the next save.
    if (!source) return;

    for (const room of rooms) projectInto(source, room, this.snapshotDeps);
  }

  /**
   * Brings the worker's open rooms for one workspace in line with the store:
   * closes the rooms whose link was revoked or expired, and leaves every other
   * room alone.
   *
   * This used to open a room for every active share of the workspace. It no
   * longer opens any: an owner's save must refresh the rooms that are **already
   * open**, and a room opens because a reader asked for it (`openShare`) or a
   * write needs it. That is what keeps a restart (and a save in a workspace with
   * fifty stored links) from loading fifty documents for nobody.
   *
   * A whole-workspace pass is still the right scope here, because closing a
   * revoked link and its baseline has to reach every open room of the workspace,
   * and the sweep relies on that to clean up after a revoke.
   */
  private async reconcileRooms(workspaceId: string): Promise<void> {
    const live = new Map<string, Share>();
    for (const share of this.options.shares.list(workspaceId)) {
      if (isProjectionShare(share) && share.roomId && isLiveShare(share)) {
        live.set(share.roomId, share);
      }
    }

    for (const [roomId, room] of [...this.rooms]) {
      if (room.workspaceId !== workspaceId) continue;
      if (live.has(roomId)) continue;
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

    // Only a workspace with an open editor room needs a writer connection: a
    // viewer is served from the saved bytes, and a publish must see live owner
    // state. Asking for one per stored editor link would load the workspace
    // document for links nobody has open.
    const hasEditor = [...this.rooms.values()].some(
      (room) => room.workspaceId === workspaceId && room.role === "editor",
    );
    if (hasEditor) await this.ensureSource(workspaceId);
    else await this.closeSource(workspaceId);
  }

  private async openRoom(share: Share): Promise<RoomState | null> {
    const client = this.client;
    const roomId = share.roomId;
    const target = targetOf(share);
    if (!client || !roomId || !target) return null;

    const doc = new LoroDoc();
    const seeded = seedRoomDocument(doc, roomId, this.snapshotDeps);
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
        return null;
      }

      const baseline = readBaseline(share.id, this.snapshotDeps);
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
        bytes: seeded,
        measured: doc.version(),
        sourceVersion: null,
        builtAt: 0,
        buildMs: 0,
        capped: false,
      };
      // A draft that survived a restart is still the editor's until it is
      // published or reloaded. The version vector cannot answer that on its own:
      // a projection written after the baseline was persisted advances the room
      // history without changing a value, so compare the allowed content.
      state.dirty =
        share.role === "editor" &&
        baseline !== null &&
        draftHasChanges(state.workspace, baseline, target, (text) => this.warn(text));
      this.watchDraft(state);
      this.rooms.set(roomId, state);
      this.opened += 1;
      // A cap breach here is the only way past `createRoom`'s check: two
      // workspaces finished their joins at the same instant. Evicting the
      // least-recently-used unattached room restores the ceiling.
      if (this.rooms.size > this.maxRooms && (await this.evictLeastRecentlyUsed())) {
        return this.rooms.get(roomId) ?? null;
      }
      return state;
    } catch (error) {
      adaptor.destroy();
      this.warn(`could not join ${roomId}: ${message(error)}`);
      return null;
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

  ensureSource(workspaceId: string): Promise<SourceRoom | null> {
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

  warn(text: string): void {
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
      buildMs: room.buildMs,
      capped: room.capped,
    }));
  }

  /**
   * Rooms opened, rooms open, the ceiling and the bytes held.
   *
   * `opened` right after boot is the boot cost, which is the number that used to
   * equal the count of stored links; `bytes` is the one that explains RSS. Both
   * are exposed through `/api/admin/status` so the next reader does not need a
   * profiler to see a regression here.
   */
  projectionStats(): ProjectionRoomStats {
    return {
      open: this.rooms.size,
      limit: this.maxRooms,
      opened: this.opened,
      evicted: this.evicted,
      refused: this.refused,
      documentBytes: sumBy([...this.rooms.values()], (room) => room.bytes),
      skipped: this.skipped,
      capped: this.capped,
      backpressured: this.backpressured,
      coalesced: this.coalesced,
      maxBuildMs: this.maxBuildMs,
    };
  }

  /** Revokes the links of projection rooms nobody has used for the idle window. */
  sweepIdle(options: { dryRun?: boolean } = {}): Promise<RoomSweepReport> {
    return this.sweeper.sweep(options);
  }
}
