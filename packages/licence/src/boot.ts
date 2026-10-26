/**
 * The self-host licence: `SUITE_LICENCE` holds a signed token and the relay
 * verifies it at boot (ADR-0081).
 *
 * A self-hosted instance has no account, so it has no control plane to mint a
 * session token and no subscription to read. The token in the environment is the
 * whole entitlement: the relay checks it once, applies its caps to the instance,
 * and refuses to start when it does not verify. A refusal is named, because an
 * operator who believes they bought capacity and did not is worse served by a
 * relay that runs unlicensed.
 */

import type { LicenceClaims, LicenceProblem } from "./claims.js";
import { licenceProblemMessage } from "./messages.js";
import { claimsQuota, type LicenceQuota } from "./quota.js";
import { verifyLicenceToken } from "./verify.js";

/** Why `SUITE_LICENCE` cannot be used. Stable strings, one per refusal case. */
export type BootLicenceRefusalCode =
  | "licence-malformed"
  | "licence-bad-signature"
  | "licence-expired"
  | "licence-unknown-version"
  | "licence-no-public-key";

/** A named refusal: `code` is for the log line, `message` is for the operator. */
export interface BootLicenceRefusal {
  code: BootLicenceRefusalCode;
  /** One sentence, safe to print: the token is never echoed back. */
  message: string;
}

/** A licence that verified, with the caps it applies to the instance. */
export interface BootLicence {
  claims: LicenceClaims;
  caps: LicenceQuota;
}

export type BootLicenceResult =
  | { ok: true; licence: BootLicence }
  | { ok: false; refusal: BootLicenceRefusal };

/** `missing` belongs to the hosted claim route, which has a request to refuse. */
const REFUSAL_CODES: Record<LicenceProblem, BootLicenceRefusalCode> = {
  missing: "licence-malformed",
  malformed: "licence-malformed",
  "bad-signature": "licence-bad-signature",
  expired: "licence-expired",
  "unknown-version": "licence-unknown-version",
  "no-public-key": "licence-no-public-key",
};

/**
 * Verifies a boot licence against the configured key, at the instant the relay
 * starts. It reads no environment: the caller has already read both values, so
 * one `SUITE_LICENCE` is checked once.
 */
export function verifyBootLicence(
  token: unknown,
  publicKeyPem: string | null,
  now: number,
): BootLicenceResult {
  const verified = verifyLicenceToken(token, now, publicKeyPem);
  if (verified.ok) {
    return { ok: true, licence: { claims: verified.claims, caps: claimsQuota(verified.claims) } };
  }

  const code = REFUSAL_CODES[verified.reason];
  return {
    ok: false,
    refusal: {
      code,
      message: `SUITE_LICENCE ${licenceProblemMessage(verified.reason)} (${code}); the relay refuses to start without a licence it can verify.`,
    },
  };
}
