import { verify } from "node:crypto";
import { decodeBase64Url } from "./base64Url.js";
import {
  isEntry,
  LICENCE_FORMAT_VERSION,
  type LicenceVerification,
  parseClaims,
  SELF_HOSTED_CLAIMS,
} from "./claims.js";
import { licenceRequired } from "./environment.js";
import { parseLicencePublicKey } from "./keys.js";

/** Longest token accepted, so a hostile body cannot make verification expensive. */
const MAX_TOKEN_LENGTH = 4096;

/**
 * Verifies one token against one key, with no environment consulted. The boot
 * licence path calls this directly: a self-hosted relay is not hosted, so the
 * environment gate in `verifyLicence` would answer before reading the token.
 */
export function verifyLicenceToken(
  token: unknown,
  now: number,
  publicKeyPem: string | null | undefined,
): LicenceVerification {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return { ok: false, reason: "malformed" };
  }

  const payloadBytes = decodeBase64Url(parts[0]);
  const signature = decodeBase64Url(parts[1]);
  if (payloadBytes === null || signature === null) return { ok: false, reason: "malformed" };

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isEntry(payload) || typeof payload.v !== "number") {
    return { ok: false, reason: "malformed" };
  }

  const key =
    publicKeyPem === null || publicKeyPem === undefined
      ? null
      : parseLicencePublicKey(publicKeyPem);
  if (key === null) return { ok: false, reason: "no-public-key" };

  if (signature.length !== 64) return { ok: false, reason: "bad-signature" };
  if (!verify(null, payloadBytes, key, signature)) return { ok: false, reason: "bad-signature" };

  if (payload.v !== LICENCE_FORMAT_VERSION) return { ok: false, reason: "unknown-version" };

  const claims = parseClaims(payload);
  if (claims === null) return { ok: false, reason: "malformed" };
  if (claims.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

/**
 * Hosted-mode verification. Signature first (so a tampered payload reports a
 * signature failure, not a version or expiry one), then version, shape, expiry.
 */
export function verifyLicence(
  token: unknown,
  now: number,
  publicKeyPem: string | null | undefined,
): LicenceVerification {
  // Self-host: no token is read, no key is required, nothing ever fails.
  if (!licenceRequired()) return { ok: true, claims: SELF_HOSTED_CLAIMS };
  return verifyLicenceToken(token, now, publicKeyPem);
}
