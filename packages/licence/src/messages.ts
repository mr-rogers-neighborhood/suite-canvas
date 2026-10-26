import type { LicenceProblem } from "./claims.js";

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
