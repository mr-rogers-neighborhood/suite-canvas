import type { PublishConflict, WorkspaceDocument } from "@suite/graph";
import type { LoroAdaptor } from "loro-adaptors/loro";
import type { LoroDoc, VersionVector } from "loro-crdt";
import type { LoroWebsocketClientRoom } from "loro-websocket";
import type { DocumentStore } from "../store/persistence.js";
import type { Share, ShareRole, ShareStore } from "../store/shares.js";

/**
 * The projection worker's vocabulary: what a share projects, what one open
 * room holds, and the small pure helpers its lifecycle and draft paths share.
 */

export type ProjectionTarget =
  | { scope: "board"; boardId: string }
  | { scope: "card"; cardId: string }
  | { scope: "selection"; boardId: string; cardIds: readonly string[] };

/** A target an editor draft may publish into; a selection share has none. */
export type PublishTarget = { scope: "board"; boardId: string } | { scope: "card"; cardId: string };

/**
 * The share-store slice the worker needs. `listAllActive` is deliberately absent:
 * the worker only ever asks about one workspace, so no code path can walk every
 * stored link and open a room for it again. `list` is still whole-workspace: a
 * reconcile pass has to see which open rooms were revoked.
 */
export type ProjectionWorkerShares = Pick<
  ShareStore,
  "list" | "getBaseline" | "setBaseline" | "deleteBaseline"
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
export interface ProjectionRoomStats {
  /** Projection rooms open right now. */
  open: number;
  /** Ceiling `SUITE_PROJECTION_ROOMS_MAX` set, or its default. */
  limit: number;
  /** Rooms opened since `start()`. */
  opened: number;
  /** Rooms closed by the ceiling to make room for a newer one. */
  evicted: number;
  /** Opens refused because every room was attached to a client. */
  refused: number;
  /** Bytes the open projection documents are estimated to hold, summed. */
  documentBytes: number;
  /**
   * Rebuild outcomes, optional so a caller that only knows the room counts can
   * still build a stats object (the admin route's empty default, a test stub).
   */
  skipped?: number;
  capped?: number;
  backpressured?: number;
  coalesced?: number;
  maxBuildMs?: number;
}

/**
 * What one rebuild did, reported once per pass so the counters in
 * `ops/metrics.ts` and the worker's own stats describe the same events.
 */
export type ProjectionRun =
  | { kind: "rebuilt"; workspaceId: string; buildMs: number }
  | { kind: "skipped"; workspaceId: string }
  | { kind: "dirty"; workspaceId: string }
  | { kind: "capped"; workspaceId: string; buildMs: number }
  | { kind: "refused"; workspaceId: string; outstanding: number }
  | { kind: "failed"; workspaceId: string; error: string };

/**
 * One timing line from the projection path, emitted only when
 * `SUITE_PROJECTION_TRACE=1`.
 *
 * The relay's own counters say *what* a rebuild did; they cannot say where the
 * wall time between an owner's save and a reader's update went. Those are three
 * different clocks — the save that asks for the rebuild (`scheduled`), the pass
 * that reads the rooms (`refresh`) and one room's rebuild (`rebuild`) — so each
 * is reported separately with the stage timings inside it.
 */
export interface ProjectionTrace {
  /** Which step of the path this line times. */
  phase: "scheduled" | "refresh" | "rebuild";
  workspaceId: string;
  /** The room, for `rebuild` lines only. */
  shareId?: string;
  /** Milliseconds this step took, or how long it waited before it ran. */
  ms: number;
  /** Stage timings, counts and flags inside the step. */
  detail: Record<string, number | string | boolean>;
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
   * Ceiling on simultaneously open projection rooms. Defaults to
   * `projectionRoomLimit()`, so `SUITE_PROJECTION_ROOMS_MAX` tunes production
   * and a test can pass a small number.
   */
  maxRooms?: number;
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
   * Called with a room id after the worker has closed it, so the sync server's
   * in-memory copy goes too — otherwise closing a room frees the worker's copy
   * but not the server's. Wired to `forgetRoomDocument`.
   *
   * A swept room has also had its stored documents and baseline deleted; an
   * evicted room has not, and its document is rebuilt from the store next time
   * somebody opens the link. Either way the in-memory copy must go.
   */
  onRoomClosed?: (roomId: string) => void;
  /**
   * Ceiling on cards one projection may build from. A board over the cap is not
   * projected: the share keeps its last good projection and the refusal is
   * counted, because a 5 000-card rebuild (measured at 8.3 s) would hold the
   * loop for everybody. Defaults to `projectionCardLimit()`.
   */
  maxCards?: number;
  /**
   * How long one rebuild may take before the room is frozen at its last good
   * projection. Defaults to `projectionBuildCap()`.
   */
  buildCapMs?: number;
  /**
   * Outstanding tasks one workspace may have queued before further rebuilds are
   * refused. Defaults to `roomOutstandingLimit()`.
   */
  outstanding?: number;
  /** Reports every rebuild outcome, so the server can count it once. */
  onRun?: (run: ProjectionRun) => void;
  /**
   * Timing sink for the rebuild path. Defaults to `console.log` when
   * `SUITE_PROJECTION_TRACE=1`, and to nothing at all otherwise, so a production
   * relay pays one env lookup per worker.
   */
  trace?: (line: ProjectionTrace) => void;
  /** Clock for idle accounting; tests replace it. */
  now?: () => number;
  logger?: Pick<Console, "warn">;
}

export interface RoomState {
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
  /** Approximate bytes this room's document holds; the ceiling's cost gauge. */
  bytes: number;
  /** Document version `bytes` was measured at, so only the delta is measured. */
  measured: VersionVector;
  /**
   * Canonical version vector of the source the last successful rebuild read.
   * Equal to the source's current vector means the projection cannot have
   * changed, so the next rebuild is skipped instead of rewritten.
   */
  sourceVersion: string | null;
  /** Epoch milliseconds of the last successful rebuild; `0` means never. */
  builtAt: number;
  /** How long the last rebuild took, in milliseconds. */
  buildMs: number;
  /**
   * Set when a rebuild exceeded the build-time cap. The room keeps what it has
   * and stops rebuilding until somebody reloads or publishes into it.
   */
  capped: boolean;
}

/** The worker's writer connection to a real workspace room, used by publish. */
export interface SourceRoom {
  workspaceId: string;
  doc: LoroDoc;
  adaptor: LoroAdaptor;
  workspace: WorkspaceDocument;
  room: LoroWebsocketClientRoom;
  /** Live connection state; a publish must not write into a dead room. */
  status: () => string;
}

export interface PendingRebuild {
  timer: NodeJS.Timeout;
  promise: Promise<void>;
  resolve: () => void;
}

export const DEFAULT_DEBOUNCE_MS = 200;
/** A brand-new room never reaches a server version, so cap the wait. */
export const JOIN_SETTLE_MS = 1000;

export const SOURCE_JOIN_WAIT_MS = 2000;

export const SOURCE_JOIN_POLL_MS = 50;
/** Cap the post-publish wait for the source room; the write is already local. */
export const SOURCE_FLUSH_MS = 200;
/** How long a publish waits for the editor's draft to reach the share room. */
export const VERSION_GATE_MS = 2000;

export const VERSION_POLL_MS = 25;

export const encoder = new TextEncoder();

export function isProjectionShare(share: Share): boolean {
  if (share.scope === "workspace" || share.roomId === null) return false;
  if (share.scope === "selection") return share.boardId !== null && share.cardIds.length > 0;
  return share.scope === "board" ? share.boardId !== null : share.cardId !== null;
}

export function isLiveShare(share: Share): boolean {
  return share.revokedAt === null && (share.expiresAt === null || share.expiresAt > Date.now());
}

export function targetOf(share: Share): ProjectionTarget | null {
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
 * Stable key for "what this share shows", so a refresh can build one projection
 * per distinct target instead of one per room.
 *
 * Four viewer links to the same board are four rooms showing one board; the
 * projection they need is the same document, and building it four times per
 * save round was four times the work for one answer. Selection links carry their
 * card list, because two selections of the same board are different targets.
 */
export function projectionTargetKey(target: ProjectionTarget): string {
  if (target.scope === "board") return `board:${target.boardId}`;
  if (target.scope === "card") return `card:${target.cardId}`;
  return `selection:${target.boardId}:${[...target.cardIds].sort().join(",")}`;
}

/**
 * Narrows a target to what a publish may write. A selection share is
 * viewer-only, so reaching this with one is a bug the caller already refused.
 */
export function publishTarget(target: ProjectionTarget): PublishTarget {
  if (target.scope === "selection") throw new Error("Selection links are read-only.");
  return target;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Canonical form of a version vector, so two documents compare by value. */
export function versionJson(doc: LoroDoc): string {
  const entries = [...doc.version().toJSON()].map(
    ([peer, counter]) => [String(peer), counter] as const,
  );
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(entries);
}

export function failure(reason: string): SharePublishResult {
  return { ok: false, conflicts: [], unsupported: [], reason };
}

/** Why a share cannot publish, or null when it may. */
export function publishProblem(share: Share): string | null {
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
export function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
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
