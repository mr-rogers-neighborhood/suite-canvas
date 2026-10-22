import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Permission } from "loro-protocol";
import { SHARE_ROOM_PREFIX, type ShareStore } from "./shares.js";

export interface AuthorizeDeps {
  shares: Pick<ShareStore, "resolve">;
  /** Shared secret the projection worker presents. See `resolveInternalToken`. */
  internalToken: string;
}

const decoder = new TextDecoder();

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

/**
 * Maps the join payload of a sync connection to a room permission.
 *
 * - A non-share room with no auth stays open: the room id itself is the owner
 *   secret (and presence/cursor rooms are derived from it).
 * - The internal token may write any room, for the projection worker.
 * - A share token opens exactly one room: the workspace it shares, or the
 *   `share-<token>` projection room for board and card links.
 */
export async function authorize(
  roomId: string,
  auth: Uint8Array,
  deps: AuthorizeDeps,
): Promise<Permission | null> {
  const token = decoder.decode(auth ?? new Uint8Array());
  const isShareRoom = roomId.startsWith(SHARE_ROOM_PREFIX);

  if (token.length === 0) return isShareRoom ? null : "write";

  if (deps.internalToken.length > 0 && constantTimeEqual(token, deps.internalToken)) {
    return "write";
  }

  const share = deps.shares.resolve(token);
  if (!share || share.roomId !== roomId) return null;

  return share.role === "editor" ? "write" : "read";
}
