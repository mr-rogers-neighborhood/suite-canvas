import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Permission } from "loro-protocol";
import { SHARE_ROOM_PREFIX, type ShareStore } from "./shares.js";
import type { WorkspaceRegistry } from "./workspaces.js";

export interface AuthorizeDeps {
  shares: Pick<ShareStore, "resolve">;
  /**
   * Owner key registry. `claimOrVerify` doubles as the first-use claim, so an
   * existing workspace can be claimed by the key the browser already holds.
   */
  workspaces: Pick<WorkspaceRegistry, "claimOrVerify" | "verify">;
  /** Shared secret the projection worker presents. See `resolveInternalToken`. */
  internalToken: string;
}

const decoder = new TextDecoder();
const EPHEMERAL_SUFFIXES = [":presence", ":cursors"] as const;

/**
 * Returns the process-wide internal token, generating and exporting one through
 * `SUITE_INTERNAL_TOKEN` when the environment does not provide it.
 */
export function resolveInternalToken(
  configured: string | undefined = process.env.SUITE_INTERNAL_TOKEN,
): string {
  const existing = configured?.trim();
  if (existing) return existing;

  const token = randomBytes(32).toString("base64url");
  process.env.SUITE_INTERNAL_TOKEN = token;
  return token;
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
 * - The internal token may write any room, for the projection worker.
 * - A share token opens exactly one room: the workspace it shares, or the
 *   `share-<token>` projection room for board and card links. Its derived
 *   presence and cursor rooms need `write` even for a viewer, because they are
 *   ephemeral and scoped to the same share.
 * - An owner key writes the workspace it owns and that workspace's derived
 *   rooms. The first use of a key claims an unclaimed workspace.
 * - Empty auth is a mismatched credential: a room id alone is not a secret.
 */
export async function authorize(
  roomId: string,
  auth: Uint8Array,
  deps: AuthorizeDeps,
): Promise<Permission | null> {
  const token = decoder.decode(auth ?? new Uint8Array());
  if (token.length === 0) return null;

  if (deps.internalToken.length > 0 && constantTimeEqual(token, deps.internalToken)) {
    return "write";
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
    return deps.workspaces.claimOrVerify(baseRoom, token) === "owner" ? "write" : null;
  } catch {
    // The registry rejects malformed ids and keys; a rejected join is not a match.
    return null;
  }
}
