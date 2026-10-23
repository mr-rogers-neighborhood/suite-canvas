import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from "node:crypto";

/**
 * Offline-verifiable hosted-sync licence.
 *
 * Token: `base64url(JSON payload) + "." + base64url(Ed25519 signature)`, where
 * the signature covers the decoded payload bytes. There is no header, no
 * algorithm field (Ed25519 is the only algorithm), and no JWT library.
 *
 * Payload fields (kept small and stable; every one is signed):
 *   v                format version, 1 today
 *   id               operator-issued identifier, recorded next to a claim
 *   tier             plan label, informational only; never gates a feature
 *   workspaces       how many workspaces this licence may claim on the relay
 *   documentBytes    per-document cap the relay applies, in bytes
 *   attachmentBytes  per-attachment cap the relay applies, in bytes
 *   issuedAt         epoch milliseconds the key was minted
 *   expiresAt        epoch milliseconds after which the key stops verifying
 *   email            optional billing contact, echoed by support tooling
 *
 * The licence never gates features: this project is open source with feature
 * parity for self-hosters. It only gates the hosted relay, and only when
 * `SUITE_HOSTED=1`. With that switch unset — every self-host — every function
 * here is inert and no token is ever parsed.
 */

export const LICENCE_FORMAT_VERSION = 1;

/** Longest token accepted, so a hostile body cannot make verification expensive. */
const MAX_TOKEN_LENGTH = 4096;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; raw keys are 32 bytes. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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

/** Why a token was refused. Each value maps to one sentence in `licenceProblemMessage`. */
export type LicenceProblem =
  | "missing"
  | "malformed"
  | "bad-signature"
  | "expired"
  | "unknown-version"
  | "no-public-key";

export type LicenceVerification =
  | { ok: true; claims: LicenceClaims }
  | { ok: false; reason: LicenceProblem };

/** The caps the hosted relay enforces; nothing else in the product reads them. */
export interface LicenceQuota {
  workspaces: number;
  documentBytes: number;
  attachmentBytes: number;
}

/** Quota reported when the licence system is inert, i.e. on every self-host. */
export const UNLIMITED_QUOTA: LicenceQuota = {
  workspaces: Number.POSITIVE_INFINITY,
  documentBytes: Number.POSITIVE_INFINITY,
  attachmentBytes: Number.POSITIVE_INFINITY,
};

const SELF_HOSTED_CLAIMS: LicenceClaims = {
  v: LICENCE_FORMAT_VERSION,
  id: "self-hosted",
  tier: "self-hosted",
  workspaces: Number.POSITIVE_INFINITY,
  documentBytes: Number.POSITIVE_INFINITY,
  attachmentBytes: Number.POSITIVE_INFINITY,
  issuedAt: 0,
  expiresAt: Number.POSITIVE_INFINITY,
};

/**
 * True only on the hosted relay. Every licence code path is inert without it,
 * so a self-host can never be asked for a key, and never parses one.
 */
export function licenceRequired(): boolean {
  return process.env.SUITE_HOSTED === "1";
}

/** Configured verification key, or null when the relay has none. */
export function licencePublicKey(): string | null {
  if (!licenceRequired()) return null;
  const value = process.env.SUITE_LICENCE_PUBLIC_KEY?.trim();
  return value && value.length > 0 ? value : null;
}

/** One sentence per refusal reason, safe to show to the person claiming. */
export function licenceProblemMessage(reason: LicenceProblem): string {
  switch (reason) {
    case "missing":
      return "no licence key was sent";
    case "malformed":
      return "the licence key is malformed";
    case "bad-signature":
      return "the licence signature does not match";
    case "expired":
      return "the licence has expired";
    case "unknown-version":
      return "the licence uses an unknown format version";
    case "no-public-key":
      return "this relay has no licence public key configured";
  }
}

function decodeBase64Url(segment: string): Buffer | null {
  if (segment.length === 0 || !BASE64URL.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  // Re-encoding rejects non-canonical input such as trailing garbage bits.
  return bytes.length > 0 && bytes.toString("base64url") === segment ? bytes : null;
}

/**
 * Accepts either a PEM SPKI block or a bare base64/base64url raw Ed25519 key,
 * so the relay can be configured from a single environment line.
 */
export function parseLicencePublicKey(value: string): KeyObject | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    if (trimmed.includes("BEGIN")) return createPublicKey(trimmed);
    const raw = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (raw.length === 32) {
      return createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: "der",
        type: "spki",
      });
    }
    return createPublicKey({ key: raw, format: "der", type: "spki" });
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

/** Validates a decoded payload; null means the payload is unusable. */
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
 * Verifies a licence token. Signature first (so a tampered payload reports a
 * signature failure, not a version or expiry one), then version, shape, expiry.
 */
export function verifyLicence(
  token: unknown,
  now: number,
  publicKeyPem: string | null | undefined,
): LicenceVerification {
  // Self-host: no token is read, no key is required, nothing ever fails.
  if (!licenceRequired()) return { ok: true, claims: SELF_HOSTED_CLAIMS };

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

/** Caps the relay should enforce. Inert — and therefore unlimited — on a self-host. */
export function licenceQuota(claims: LicenceClaims): LicenceQuota {
  if (!licenceRequired()) return UNLIMITED_QUOTA;
  return {
    workspaces: claims.workspaces,
    documentBytes: claims.documentBytes,
    attachmentBytes: claims.attachmentBytes,
  };
}

/** Mints a token. Only the operator tool and tests use this. */
export function signLicence(claims: LicenceClaims, privateKeyPem: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: claims.v,
      id: claims.id,
      tier: claims.tier,
      workspaces: claims.workspaces,
      documentBytes: claims.documentBytes,
      attachmentBytes: claims.attachmentBytes,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
      ...(claims.email === undefined ? {} : { email: claims.email }),
    }),
    "utf8",
  );
  const signature = sign(null, payload, createPrivateKey(privateKeyPem));
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}
