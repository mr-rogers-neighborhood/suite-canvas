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
 * in this package is inert and no token is ever parsed.
 */

export const LICENCE_FORMAT_VERSION = 1;

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

/** What a self-host reports: no document, no expiry, no cap. */
export const SELF_HOSTED_CLAIMS: LicenceClaims = {
  v: LICENCE_FORMAT_VERSION,
  id: "self-hosted",
  tier: "self-hosted",
  workspaces: Number.POSITIVE_INFINITY,
  documentBytes: Number.POSITIVE_INFINITY,
  attachmentBytes: Number.POSITIVE_INFINITY,
  issuedAt: 0,
  expiresAt: Number.POSITIVE_INFINITY,
};

/** True for a plain JSON object, which every claim container must be. */
export function isEntry(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates a decoded payload; null means the payload is unusable. */
export function parseClaims(value: unknown): LicenceClaims | null {
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
