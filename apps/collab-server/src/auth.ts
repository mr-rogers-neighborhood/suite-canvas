import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Permission } from "loro-protocol";
import { SHARE_ROOM_PREFIX, type ShareStore } from "./shares.js";
import type { WorkspaceRegistry } from "./workspaces.js";

export interface AuthorizeDeps {
  shares: Pick<ShareStore, "resolve" | "hasEditorShare">;
  /**
   * Owner key registry. Joins verify only: claiming is an explicit HTTP call
   * before the app boots, so an unknown credential cannot create registry rows.
   */
  workspaces: Pick<WorkspaceRegistry, "verify">;
  /** Worker token that may write projection rooms only. */
  projectionToken: string;
  /** Worker token that may write a workspace room only when an editor share exists. */
  sourceToken: string;
}

export interface WorkerTokens {
  projectionToken: string;
  sourceToken: string;
}

const decoder = new TextDecoder();
const EPHEMERAL_SUFFIXES = [":presence", ":cursors"] as const;

/**
 * Returns the two scoped worker tokens. They are deliberately separate: the
 * projection token can only touch projection rooms, and the source token can
 * only touch a workspace that currently has an editor share. `SUITE_INTERNAL_TOKEN`
 * is accepted as the projection token for upgrades, never as both.
 */
export function resolveWorkerTokens(env: NodeJS.ProcessEnv = process.env): WorkerTokens {
  const projectionToken =
    env.SUITE_PROJECTION_TOKEN?.trim() || env.SUITE_INTERNAL_TOKEN?.trim() || "";
  const sourceToken = env.SUITE_SOURCE_TOKEN?.trim() || "";

  const projection = projectionToken || randomBytes(32).toString("base64url");
  const source = sourceToken || randomBytes(32).toString("base64url");
  env.SUITE_PROJECTION_TOKEN = projection;
  env.SUITE_SOURCE_TOKEN = source;
  return { projectionToken: projection, sourceToken: source };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Presence and cursor rooms are derived from the room they describe. */
function baseRoomOf(roomId: string): string {
  for (const suffix of EPHEMERAL_SUFFIXES) {
    if (roomId.length > suffix.length && roomId.endsWith(suffix)) {
      return roomId.slice(0, -suffix.length);
    }
  }
  return roomId;
}

/**
 * Maps the join payload of a sync connection to a room permission.
 *
 * - The projection token may write projection (`share-`) rooms only.
 * - The source token may write a workspace room only when that workspace has an
 *   active editor share; it exists solely for the publish worker.
 * - A share token opens exactly one room: the workspace it shares, or the
 *   `share-<token>` projection room for board and card links. Its derived
 *   presence and cursor rooms need `write` even for a viewer, because they are
 *   ephemeral and scoped to the same share.
 * - An owner key verifies against the workspace it owns and that workspace's
 *   derived rooms. An unknown key never claims a room implicitly.
 * - Empty auth is a mismatched credential: a room id alone is not a secret.
 */
export async function authorize(
  roomId: string,
  auth: Uint8Array,
  deps: AuthorizeDeps,
): Promise<Permission | null> {
  const token = decoder.decode(auth ?? new Uint8Array());
  if (token.length === 0) return null;

  if (
    deps.projectionToken.length > 0 &&
    constantTimeEqual(token, deps.projectionToken) &&
    baseRoomOf(roomId).startsWith(SHARE_ROOM_PREFIX)
  ) {
    return "write";
  }

  if (deps.sourceToken.length > 0 && constantTimeEqual(token, deps.sourceToken)) {
    const workspaceRoom = baseRoomOf(roomId);
    if (!workspaceRoom.startsWith(SHARE_ROOM_PREFIX) && deps.shares.hasEditorShare(workspaceRoom)) {
      return "write";
    }
    return null;
  }

  const share = deps.shares.resolve(token);
  if (share) {
    if (roomId === share.roomId) return share.role === "editor" ? "write" : "read";
    return baseRoomOf(roomId) === share.roomId ? "write" : null;
  }

  const baseRoom = baseRoomOf(roomId);
  // Projection rooms belong to a share, not to an owner key: claiming one would
  // let any key write into a workspace it does not own.
  if (baseRoom.startsWith(SHARE_ROOM_PREFIX)) return null;

  try {
    return deps.workspaces.verify(baseRoom, token) ? "write" : null;
  } catch {
    // The registry rejects malformed ids and keys; a rejected join is not a match.
    return null;
  }
}
