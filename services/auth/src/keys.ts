import { createHash, randomBytes } from "node:crypto";

/**
 * Invite keys are bearer capabilities, exactly like the owner key and the share
 * tokens the relay already stores: 32 random bytes, presented once, stored only
 * as a SHA-256 hash. A leaked control-plane database therefore hands out no
 * working invitation, and the key can be logged by id without leaking.
 */
const INVITE_KEY_BYTES = 32;

/** Longest key accepted on redemption, so a hostile body cannot hash forever. */
export const MAX_INVITE_KEY_LENGTH = 512;

export function generateInviteKey(): string {
  return randomBytes(INVITE_KEY_BYTES).toString("base64url");
}

export function hashInviteKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** True for the base64url shape `generateInviteKey` produces; used to reject junk early. */
export function looksLikeInviteKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_INVITE_KEY_LENGTH &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}
