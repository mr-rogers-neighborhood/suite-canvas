/**
 * Client-side licence handling for the hosted relay.
 *
 * A licence token is `base64url(payload) + "." + base64url(Ed25519 signature)`,
 * the same compact format the relay verifies with `node:crypto`. Verification
 * here exists to *message* the workspace owner ("your key expired on …"), never
 * to enforce anything: a tampered client can always skip this check, so the
 * relay is the gate. Local editing never depends on a licence at all.
 */

export interface LicenceClaims {
  v: number;
  id: string;
  tier: string;
  workspaces: number;
  documentBytes: number;
  attachmentBytes: number;
  issuedAt: number;
  expiresAt: number;
  email?: string;
}

export type LicenceProblem =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "unknown-version"
  | "unsupported";

export type LicenceVerification =
  | { ok: true; claims: LicenceClaims }
  | { ok: false; reason: LicenceProblem };

export type LicenceStatus = "active" | "expired" | "invalid" | "missing";

export interface LicenceStatusReport {
  status: LicenceStatus;
  /** Plain sentence for the owner; every status has one. */
  sentence: string;
  claims: LicenceClaims | null;
  /** Why verification failed, when it did. */
  reason: LicenceProblem | null;
}

export const LICENCE_FORMAT_VERSION = 1;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const STORAGE_PREFIX = "suite.licence.";

/** `localStorage` key for one workspace's token. */
export function licenceStorageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

/** Saves a token for a workspace; returns false when storage is unavailable. */
export function storeLicence(workspaceId: string, token: string): boolean {
  try {
    window.localStorage.setItem(licenceStorageKey(workspaceId), token);
    return true;
  } catch {
    return false;
  }
}

/** The stored token, or null when none is saved or storage is unavailable. */
export function readLicence(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(licenceStorageKey(workspaceId));
  } catch {
    return null;
  }
}

export function clearLicence(workspaceId: string): void {
  try {
    window.localStorage.removeItem(licenceStorageKey(workspaceId));
  } catch {
    // A blocked storage quota or privacy mode is not an error worth surfacing.
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length === 0 || !BASE64URL.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(withPadding);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    // Re-encoding rejects non-canonical segments such as stray trailing bits.
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Accepts a PEM SPKI block or a bare base64/base64url raw Ed25519 key. */
function publicKeyBytes(
  publicKey: string,
): { bytes: Uint8Array<ArrayBuffer>; format: "raw" | "spki" } | null {
  const trimmed = publicKey.trim();
  if (trimmed.length === 0) return null;
  try {
    if (trimmed.includes("BEGIN")) {
      const body = trimmed
        .replace(/-----BEGIN [^-]+-----/g, "")
        .replace(/-----END [^-]+-----/g, "")
        .replace(/\s+/g, "");
      const bytes = base64UrlToBytes(
        body.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
      );
      return bytes === null ? null : { bytes, format: "spki" };
    }
    const raw = base64UrlToBytes(
      trimmed.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    );
    if (raw === null) return null;
    return { bytes: raw, format: raw.length === 32 ? "raw" : "spki" };
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseClaims(value: unknown): LicenceClaims | null {
  if (!isEntry(value)) return null;
  const { id, tier, workspaces, documentBytes, attachmentBytes, issuedAt, expiresAt, email } =
    value;
  if (!isText(id, 200) || !isText(tier, 64)) return null;
  if (!isCount(workspaces) || !isCount(documentBytes) || !isCount(attachmentBytes)) return null;
  if (!isCount(issuedAt) || !isCount(expiresAt) || expiresAt <= issuedAt) return null;
  if (email !== undefined && !isText(email, 320)) return null;

  const claims: LicenceClaims = {
    v: LICENCE_FORMAT_VERSION,
    id,
    tier,
    workspaces,
    documentBytes,
    attachmentBytes,
    issuedAt,
    expiresAt,
  };
  if (email !== undefined) claims.email = email;
  return claims;
}

/**
 * Verifies a token with WebCrypto Ed25519. Messaging only — see the module
 * comment: the relay re-verifies every claim, so bypassing this changes
 * nothing except what the owner is told.
 */
export async function verifyLicenceOffline(
  token: string,
  publicKey: string,
  now: number = Date.now(),
): Promise<LicenceVerification> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { ok: false, reason: "unsupported" };

  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return { ok: false, reason: "malformed" };
  }
  const payloadBytes = base64UrlToBytes(parts[0]);
  const signature = base64UrlToBytes(parts[1]);
  if (payloadBytes === null || signature === null) return { ok: false, reason: "malformed" };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isEntry(payload) || typeof payload.v !== "number") {
    return { ok: false, reason: "malformed" };
  }

  const keyBytes = publicKeyBytes(publicKey);
  if (keyBytes === null) return { ok: false, reason: "malformed" };

  let key: CryptoKey;
  try {
    key = await subtle.importKey(keyBytes.format, keyBytes.bytes, { name: "Ed25519" }, false, [
      "verify",
    ]);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let valid = false;
  try {
    valid = await subtle.verify({ name: "Ed25519" }, key, signature, payloadBytes);
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
  if (!valid) return { ok: false, reason: "bad-signature" };

  if (payload.v !== LICENCE_FORMAT_VERSION) return { ok: false, reason: "unknown-version" };

  const claims = parseClaims(payload);
  if (claims === null) return { ok: false, reason: "malformed" };
  if (claims.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

function day(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Payload of an unverified token, used only to word the "expired" sentence.
 * Its values are never treated as grants.
 */
function unverifiedClaims(token: string): LicenceClaims | null {
  const [payload] = token.split(".");
  if (payload === undefined) return null;
  const bytes = base64UrlToBytes(payload);
  if (bytes === null) return null;
  try {
    return parseClaims(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Human status for a token. Never used to block an action: an `invalid` or
 * `expired` result only changes the message shown to the workspace owner.
 */
export async function licenceStatus(
  token: string | null | undefined,
  publicKey: string,
  now: number = Date.now(),
): Promise<LicenceStatusReport> {
  if (token === null || token === undefined || token.trim().length === 0) {
    return {
      status: "missing",
      sentence:
        "No licence key is saved for this workspace. Local editing works; hosted sync needs a key.",
      claims: null,
      reason: null,
    };
  }

  const verification = await verifyLicenceOffline(token, publicKey, now);
  if (verification.ok) {
    const { claims } = verification;
    return {
      status: "active",
      sentence: `Licence active: ${claims.tier} plan, up to ${claims.workspaces} workspaces, valid until ${day(claims.expiresAt)}.`,
      claims,
      reason: null,
    };
  }

  if (verification.reason === "expired") {
    // Decoded without verifying a second time, purely to name the expiry date
    // in the message; nothing here decides access.
    const claims = unverifiedClaims(token);
    return {
      status: "expired",
      sentence: claims
        ? `This licence expired on ${day(claims.expiresAt)}. Hosted sync will refuse it until the key is renewed; local editing keeps working.`
        : "This licence has expired. Hosted sync will refuse it until the key is renewed; local editing keeps working.",
      claims,
      reason: "expired",
    };
  }

  return {
    status: "invalid",
    sentence:
      verification.reason === "unsupported"
        ? "This browser cannot verify licence keys (WebCrypto Ed25519 is unavailable). Local editing is unaffected."
        : "This licence key could not be verified. Check that the whole key was pasted. Local editing is unaffected.",
    claims: null,
    reason: verification.reason,
  };
}
