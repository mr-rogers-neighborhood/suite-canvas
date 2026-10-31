import { performance } from "node:perf_hooks";
import {
  type ProjectionResult,
  planPublish,
  projectWorkspace,
  WorkspaceDocument,
} from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import type { DocumentStore } from "../store/persistence.js";
import { type MirrorStats, mirrorWorkspace } from "./mirror.js";
import type {
  ProjectionRun,
  ProjectionTarget,
  ProjectionTrace,
  ProjectionWorkerShares,
  RoomState,
  SourceRoom,
} from "./model.js";
import { message, projectionTargetKey, publishTarget, versionJson } from "./model.js";
import { loadLoroDocument } from "./rooms.js";

/**
 * The rebuild step: turning a saved or live workspace into the bytes a share
 * room serves. Everything here is a function of the source, the room and the
 * stores, so a rebuild can be reasoned about without the worker's timers.
 */

export interface SnapshotDeps {
  documents: Pick<DocumentStore, "load">;
  shares: ProjectionWorkerShares;
  /** Live writer connections, keyed by workspace. */
  sources: ReadonlyMap<string, SourceRoom>;
  touch(room: RoomState): void;
  warn(text: string): void;
  /** Clock for build timing; the worker's clock, so a test can freeze it. */
  now: () => number;
  /** Cards one projection may build from. */
  maxCards: number;
  /** How long one rebuild may take before its room is frozen. */
  buildCapMs: number;
  /** Reports every rebuild outcome once, for the counters. */
  report: (run: ProjectionRun) => void;
  /** Emits one timing line per rebuild when the operator turned tracing on. */
  trace?: (line: ProjectionTrace) => void;
}

/** Milliseconds on a monotonic clock, for stage timings a wall clock cannot hold. */
function elapsed(started: number): number {
  return performance.now() - started;
}

/**
 * Seeds the room document from what the server last saved. Its history gives
 * the worker's first rebuild a lamport clock above every earlier projection,
 * so the rewrite wins instead of losing to a stale op.
 */
export function seedRoomDocument(
  doc: LoroDoc,
  roomId: string,
  deps: Pick<SnapshotDeps, "documents" | "warn">,
): number {
  const state = loadLoroDocument(deps.documents, roomId);
  if (!state) return 0;
  try {
    doc.import(state);
    return state.length;
  } catch (error) {
    deps.warn(`ignoring unreadable projection state for ${roomId}: ${message(error)}`);
    return 0;
  }
}

export function documentFromSnapshot(
  snapshot: Uint8Array,
  deps: Pick<SnapshotDeps, "warn">,
): WorkspaceDocument | null {
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
  } catch (error) {
    deps.warn(`ignoring unreadable snapshot: ${message(error)}`);
    return null;
  }
  return new WorkspaceDocument(doc);
}

export function readBaseline(shareId: string, deps: SnapshotDeps): WorkspaceDocument | null {
  let snapshot: Uint8Array | null = null;
  try {
    snapshot = deps.shares.getBaseline(shareId);
  } catch (error) {
    deps.warn(`could not read the baseline for ${shareId}: ${message(error)}`);
    return null;
  }
  return snapshot ? documentFromSnapshot(snapshot, deps) : null;
}

/** Persists the projection just written and makes it the draft's base. */
export function persistBaseline(room: RoomState, deps: SnapshotDeps): void {
  const snapshot = room.doc.export({ mode: "shallow-snapshot", frontiers: room.doc.frontiers() });
  try {
    deps.shares.setBaseline(room.shareId, snapshot);
  } catch (error) {
    deps.warn(`could not persist the baseline for ${room.shareId}: ${message(error)}`);
  }
  room.baseline = documentFromSnapshot(snapshot, deps);
  room.baselineVersion = versionJson(room.doc);
  room.dirty = false;
  // The snapshot is the document, so it is the exact byte figure; nothing is
  // left to measure on the delta path for this room.
  room.bytes = snapshot.length;
  room.measured = room.doc.version();
}

/**
 * Loads a workspace for projection: the live source room when the workspace
 * has editor shares, otherwise the last saved bytes.
 */
export function loadSourceDocument(
  workspaceId: string,
  deps: SnapshotDeps,
): WorkspaceDocument | null {
  const live = deps.sources.get(workspaceId);
  if (live) return live.workspace;

  const state = loadLoroDocument(deps.documents, workspaceId);
  if (!state) return null;
  return documentFromSnapshot(state, deps);
}

/**
 * Rebuilds one room from the source, or explains why it did not.
 *
 * Three things can stop the write, in increasing cost:
 *
 * 1. **Dirty draft** — an editor owns the room's content; an owner save must not
 *    overwrite it.
 * 2. **Unchanged source** — the room records the source's canonical version
 *    vector at its last successful rebuild. While that vector is equal, the
 *    projection is a pure function of a source that has not moved, so the
 *    rebuild cannot produce a different document. Editing one card on a board
 *    nobody shared used to clear and rewrite every share of that board; now it
 *    costs one version comparison per room.
 * 3. **A frozen room** — a build that exceeded `buildCapMs` marks the room
 *    capped, so a board too slow to project stops being projected on every save
 *    interval instead of holding the loop. `reload` and `publish` clear it.
 *
 * The rebuild itself is timed, because that number is what the cap and the
 * operator's report are made of.
 *
 * `builds` is the one-pass cache a refresh passes in: rooms that show the same
 * target share one projection, because a board with four viewer links needs one
 * build, not four. It is keyed by `projectionTargetKey` and lives only as long
 * as the pass, so it can never serve a projection built from a stale source.
 */
export function projectInto(
  source: WorkspaceDocument,
  room: RoomState,
  deps: SnapshotDeps,
  builds?: Map<string, ProjectionResult>,
): void {
  // An owner save is activity even when the rebuild is held back: the room is
  // still the one this workspace projects into.
  deps.touch(room);
  if (room.dirty) {
    deps.report({ kind: "dirty", workspaceId: room.workspaceId });
    return;
  }
  if (room.capped) {
    deps.report({ kind: "capped", workspaceId: room.workspaceId, buildMs: room.buildMs });
    return;
  }
  const sourceVersion = versionJson(source.doc);
  if (room.builtAt > 0 && room.sourceVersion === sourceVersion) {
    deps.report({ kind: "skipped", workspaceId: room.workspaceId });
    return;
  }

  const started = deps.now();
  const timing = performance.now();
  let projectMs = 0;
  let applyMs = 0;
  let persistMs = 0;
  let mirror: MirrorStats = { written: 0, removed: 0, kept: 0 };
  try {
    const cards = projectionCardCount(source, room.target);
    if (cards > deps.maxCards) {
      room.capped = true;
      deps.warn(
        `refusing to project ${room.shareId}: the board holds ${String(cards)} cards, over the ` +
          `cap of ${String(deps.maxCards)} (SUITE_MAX_PROJECTION_CARDS). The share keeps its ` +
          "last good projection; reload it after splitting the board.",
      );
      deps.report({
        kind: "capped",
        workspaceId: room.workspaceId,
        buildMs: 0,
      });
      return;
    }
    const projectedAt = performance.now();
    const key = projectionTargetKey(room.target);
    let projection = builds?.get(key);
    if (projection === undefined) {
      projection = projectWorkspace(source, room.target);
      builds?.set(key, projection);
    }
    const appliedAt = performance.now();
    projectMs = elapsed(projectedAt);
    mirror = mirrorWorkspace(room.workspace, projection.workspace);
    const persistedAt = performance.now();
    applyMs = elapsed(appliedAt);
    // Viewers never publish; only an editor draft needs a baseline snapshot.
    // That snapshot also re-measures the room, so only viewers measure here.
    if (room.role === "editor") persistBaseline(room, deps);
    else measureRoom(room, deps.warn);
    persistMs = elapsed(persistedAt);
  } catch (error) {
    // A trashed or deleted card has nothing to publish; keep the last good
    // projection rather than emptying a share the viewer may be reading.
    const reason = message(error);
    deps.warn(`projection for ${room.shareId} skipped: ${reason}`);
    deps.report({ kind: "failed", workspaceId: room.workspaceId, error: reason });
    return;
  }

  const buildMs = Math.max(0, deps.now() - started);
  room.buildMs = buildMs;
  room.builtAt = deps.now();
  room.sourceVersion = sourceVersion;
  deps.trace?.({
    phase: "rebuild",
    workspaceId: room.workspaceId,
    shareId: room.shareId,
    ms: elapsed(timing),
    detail: {
      projectMs: Number(projectMs.toFixed(2)),
      applyMs: Number(applyMs.toFixed(2)),
      persistMs: Number(persistMs.toFixed(2)),
      written: mirror.written,
      removed: mirror.removed,
      kept: mirror.kept,
      documentBytes: room.bytes,
    },
  });
  if (buildMs > deps.buildCapMs) {
    room.capped = true;
    deps.warn(
      `freezing the projection of ${room.shareId}: the rebuild took ${String(buildMs)} ms, over ` +
        `the ${String(deps.buildCapMs)} ms cap (SUITE_PROJECTION_BUILD_MS). It keeps its last ` +
        "good projection until it is reloaded or published into.",
    );
    deps.report({ kind: "capped", workspaceId: room.workspaceId, buildMs });
    return;
  }
  deps.report({ kind: "rebuilt", workspaceId: room.workspaceId, buildMs });
}

/**
 * Cards the projection will build from, read from the source before the build so
 * an oversized board costs a count rather than a rebuild.
 */
export function projectionCardCount(source: WorkspaceDocument, target: ProjectionTarget): number {
  if (target.scope === "card") return 1;
  if (target.scope === "selection") return target.cardIds.length;
  return source.listBoardCards(target.boardId).length;
}

/** Rebuilds the projection and resets the draft's baseline. */
export function reprojectInto(
  source: WorkspaceDocument,
  room: RoomState,
  deps: SnapshotDeps,
): void {
  const started = deps.now();
  const projection = projectWorkspace(source, room.target);
  mirrorWorkspace(room.workspace, projection.workspace);
  // Viewers never publish; only an editor draft needs a baseline snapshot.
  // That snapshot also re-measures the room, so only viewers measure here.
  if (room.role === "editor") persistBaseline(room, deps);
  else measureRoom(room, deps.warn);
  // An explicit rebuild — a reload, a publish — is always honoured: it clears
  // both the skip key and a freeze, and records what it cost.
  room.sourceVersion = versionJson(source.doc);
  room.builtAt = deps.now();
  room.buildMs = Math.max(0, deps.now() - started);
  room.capped = false;
  deps.report({ kind: "rebuilt", workspaceId: room.workspaceId, buildMs: room.buildMs });
}

/**
 * Adds the bytes written since the last measurement to the room's size, so
 * the admin status can attribute resident memory to projection documents.
 *
 * The delta, never the whole document: a snapshot export per save would cost
 * as much as the save itself. Measurement is observability, so a failure here
 * is logged and never allowed to cost a projection.
 */
export function measureRoom(room: RoomState, warn: (text: string) => void): void {
  try {
    room.bytes += room.doc.export({ mode: "update", from: room.measured }).length;
    room.measured = room.doc.version();
  } catch (error) {
    warn(`could not measure the projection of ${room.shareId}: ${message(error)}`);
  }
}

/**
 * Whether the draft's allowed content differs from the baseline. A restarted
 * worker cannot use the version vector for this: the server may have applied a
 * projection after the baseline was persisted, which advances the history
 * without changing a value. Only real draft edits should pause projection.
 */
export function draftHasChanges(
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  target: ProjectionTarget,
  warn: (text: string) => void,
): boolean {
  try {
    return planPublish(draft, baseline, baseline, publishTarget(target)).changes.length > 0;
  } catch (error) {
    // Comparing must never freeze a room; a broken comparison reads as clean.
    warn(`could not compare a draft with its baseline: ${message(error)}`);
    return false;
  }
}
