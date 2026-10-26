/**
 * `@suite/licence` — the hosted-sync licence token, owned in one place.
 *
 * The relay verifies tokens and the billing service mints them, so the format,
 * the Ed25519 path and the claims type live here rather than in either service.
 * Nothing in this package knows about HTTP, a database or a document: it reads
 * two environment variables (`SUITE_HOSTED`, `SUITE_LICENCE_PUBLIC_KEY`) and
 * otherwise is a pure function of its arguments.
 *
 * The token layout and the payload fields are documented in `claims.ts`.
 */

export { decodeBase64Url } from "./base64Url.js";
export {
  isEntry,
  LICENCE_FORMAT_VERSION,
  type LicenceClaims,
  type LicenceProblem,
  type LicenceVerification,
  parseClaims,
  SELF_HOSTED_CLAIMS,
} from "./claims.js";
export { licencePublicKey, licenceRequired } from "./environment.js";
export { parseLicencePublicKey } from "./keys.js";
export { licenceProblemMessage } from "./messages.js";
export { type LicenceQuota, licenceQuota, UNLIMITED_QUOTA } from "./quota.js";
export { signLicence } from "./sign.js";
export { verifyLicence } from "./verify.js";
