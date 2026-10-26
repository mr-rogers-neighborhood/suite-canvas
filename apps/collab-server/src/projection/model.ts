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
