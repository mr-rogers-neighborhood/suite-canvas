import { setTimeout as delay } from "node:timers/promises";
import { applyPublish, planPublish, type WorkspaceDocument } from "@suite/graph";
import { VersionVector } from "loro-crdt";
import { RoomJoinStatus } from "loro-websocket";
import { err, ok, type Result } from "neverthrow";
import type { Share } from "../store/shares.js";
import type {
  ProjectionTarget,
  RoomState,
  SharePublishResult,
  ShareStatus,
  ShareVersion,
  SourceRoom,
} from "./model.js";
import {
  failure,
  message,
  publishProblem,
  publishTarget,
  SOURCE_FLUSH_MS,
  SOURCE_JOIN_POLL_MS,
  SOURCE_JOIN_WAIT_MS,
  settleWithin,
  VERSION_GATE_MS,
  VERSION_POLL_MS,
  versionJson,
} from "./model.js";

/**
 * Publish, reload and draft status: the three operations an *editor* link can
 * ask for. They are written against `DraftHost` rather than the worker so the
 * queueing, the room bookkeeping and the projection stay the worker's business.
 */

export interface DraftHost {
  isStarted(): boolean;
  hasRoom(roomId: string): boolean;
  roomOf(roomId: string): RoomState | undefined;
  openRoomNow(share: Share): Promise<void>;
  ensureSource(workspaceId: string): Promise<SourceRoom | null>;
  touch(room: RoomState): void;
  enqueue<T>(workspaceId: string, work: () => Promise<T>): Promise<T>;
  loadBaseline(shareId: string): WorkspaceDocument | null;
  captureBaseline(room: RoomState): void;
  reproject(source: WorkspaceDocument, room: RoomState): void;
  draftDiffers(
    draft: WorkspaceDocument,
    baseline: WorkspaceDocument,
    target: ProjectionTarget,
  ): boolean;
  warn(text: string): void;
}

/**
 * Publishes an editor's draft into its workspace. The share room, its source
 * room and a baseline are all required: a publish never falls back to saved
 * bytes, because those may lag the owner's live edits.
 *
 * `overwrite` names the conflicting keys whose draft value wins. An empty
 * array is meaningful: it keeps every workspace value.
 */
export function publishDraft(
  host: DraftHost,
  share: Share,
  version?: ShareVersion,
  overwrite?: readonly string[],
): Promise<SharePublishResult> {
  if (!host.isStarted()) return Promise.resolve(failure("The share service is not running."));
  return host
    .enqueue(share.workspaceId, () => publishNow(host, share, version, overwrite))
    .catch((error: unknown) => failure(message(error)));
}

/**
 * Reports whether a share's draft differs from its baseline. A room that is
 * not open yet is joined first, so the answer is about the draft, not about
 * which shares happen to be warm.
 */
export function draftStatus(host: DraftHost, share: Share): Promise<ShareStatus> {
  const idle: ShareStatus = { dirty: false, hasBaseline: false };
  if (!host.isStarted()) return Promise.resolve(idle);
  return host
    .enqueue(share.workspaceId, () => statusNow(host, share))
    .catch((error: unknown) => {
      host.warn(`could not read the status of ${share.id}: ${message(error)}`);
      return idle;
    });
}

/** Discards an editor's draft and rebuilds it from the workspace. */
export function reloadDraft(host: DraftHost, share: Share): Promise<SharePublishResult> {
  if (!host.isStarted()) return Promise.resolve(failure("The share service is not running."));
  return host
    .enqueue(share.workspaceId, () => reloadNow(host, share))
    .catch((error: unknown) => failure(message(error)));
}

/** The two documents a publish writes between, once both are known to exist. */
export interface PreparedDraft {
  room: RoomState;
  source: SourceRoom;
}

async function prepareDraft(
  host: DraftHost,
  share: Share,
): Promise<Result<PreparedDraft, SharePublishResult>> {
  const problem = publishProblem(share);
  if (problem) return err(failure(problem));
  const roomId = share.roomId as string;

  // A share created since the last refresh has no room yet, and a publish
  // must be written: open exactly this share's room, not its workspace's.
  if (!host.hasRoom(roomId)) await host.openRoomNow(share);
  const room = host.roomOf(roomId);
  if (!room) return err(failure("The share room is not open."));
  if (room.role !== "editor") return err(failure("This link is read-only."));

  if (!room.baseline) {
    const baseline = host.loadBaseline(room.shareId);
    if (baseline) {
      room.baseline = baseline;
      room.baselineVersion = versionJson(baseline.doc);
    }
  }

  // A publish must see the owner's live state; saved bytes are not good enough.
  const source = await host.ensureSource(share.workspaceId);
  if (!source) return err(failure("The workspace is not reachable right now; try again."));
  if (source.status() !== RoomJoinStatus.Joined && !(await waitForSource(source))) {
    host.warn(`source ${share.workspaceId} is ${source.status()} for share ${share.id}`);
    return err(failure("The workspace connection is not available right now; try again."));
  }
  return ok({ room, source });
}

/**
 * Reads, and if needed opens, the room behind a share. A viewer or a share
 * without a room has no draft to report.
 */
export async function statusNow(host: DraftHost, share: Share): Promise<ShareStatus> {
  const idle: ShareStatus = { dirty: false, hasBaseline: false };
  if (share.role !== "editor" || share.scope === "workspace" || !share.roomId) return idle;
  const roomId = share.roomId;

  // A share created since the last refresh has no room yet; reading its
  // draft is a reason to open exactly this room.
  if (!host.hasRoom(roomId)) await host.openRoomNow(share);
  const room = host.roomOf(roomId);
  if (!room) return idle;
  host.touch(room);

  if (!room.baseline) {
    const baseline = host.loadBaseline(room.shareId);
    if (baseline) {
      room.baseline = baseline;
      room.baselineVersion = versionJson(baseline.doc);
      room.dirty = host.draftDiffers(room.workspace, baseline, room.target);
    }
  }
  return { dirty: room.role === "editor" && room.dirty, hasBaseline: room.baseline !== null };
}

export async function publishNow(
  host: DraftHost,
  share: Share,
  version?: ShareVersion,
  overwrite?: readonly string[],
): Promise<SharePublishResult> {
  const prepared = await prepareDraft(host, share);
  if (prepared.isErr()) return prepared.error;
  const { room, source } = prepared.value;
  host.touch(room);
  const baseline = room.baseline;
  if (!baseline) return failure("This share has no baseline yet; reload it from the workspace.");

  if (version) {
    const target = versionVector(version, host.warn);
    if (!target) return failure("The publish version is malformed.");
    // The editor's write travels over the sync socket, the publish over HTTP.
    // Without this gate a fast click publishes the room before that write
    // lands, and the rebuild puts the old value back.
    if (!(await waitForVersion(room, target))) {
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
    host.reproject(source.workspace, room);
  } catch (error) {
    // The publish landed; the view just cannot be rebuilt (e.g. the card was
    // trashed in the workspace). Keep the draft as the new baseline so the
    // editor is not stuck dirty.
    host.warn(`could not rebuild ${room.shareId} after publish: ${message(error)}`);
    host.captureBaseline(room);
  }
  return { ok: true, applied };
}

export async function reloadNow(host: DraftHost, share: Share): Promise<SharePublishResult> {
  const prepared = await prepareDraft(host, share);
  if (prepared.isErr()) return prepared.error;
  const { room, source } = prepared.value;
  host.touch(room);

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
    host.reproject(source.workspace, room);
  } catch (error) {
    host.warn(`could not reload ${room.shareId}: ${message(error)}`);
    return failure("The workspace has nothing to show for this share right now.");
  }
  return { ok: true, applied: discarded };
}

export function versionVector(
  version: ShareVersion,
  warn: (text: string) => void,
): VersionVector | null {
  try {
    return VersionVector.parseJSON(new Map(Object.entries(version)) as Map<`${number}`, number>);
  } catch (error) {
    warn(`ignoring a malformed publish version: ${message(error)}`);
    return null;
  }
}

/** Polls the share room until its version includes `target`, or gives up. */
/** A source room may still be joining when a publish arrives; give it a beat. */
export async function waitForSource(source: SourceRoom): Promise<boolean> {
  const deadline = Date.now() + SOURCE_JOIN_WAIT_MS;
  while (Date.now() < deadline) {
    if (source.status() === RoomJoinStatus.Joined) return true;
    await delay(SOURCE_JOIN_POLL_MS);
  }
  return source.status() === RoomJoinStatus.Joined;
}

export async function waitForVersion(room: RoomState, target: VersionVector): Promise<boolean> {
  const deadline = Date.now() + VERSION_GATE_MS;
  for (;;) {
    const comparison = room.doc.version().compare(target);
    if (comparison !== undefined && comparison >= 0) return true;
    if (Date.now() >= deadline) return false;
    await delay(VERSION_POLL_MS);
  }
}
