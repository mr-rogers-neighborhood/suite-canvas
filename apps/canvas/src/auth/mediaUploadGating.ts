import { isStandalone } from "../session/mode";
import { currentCredentialClaims } from "./credential";

export interface MediaUploadPermission {
  allowed: boolean;
  reason?: string;
  tier?: string;
}

/**
 * Checks whether the current session/tier is permitted to upload media files (images & videos).
 * - Standalone or self-hosted: permitted (unlimited / local-first).
 * - Personal, Organization, Pro, Enterprise tiers: permitted.
 * - Free tier on hosted relay: not permitted, upgrade prompt.
 */
export function canUploadMedia(tierOverride?: string | null): MediaUploadPermission {
  if (isStandalone()) {
    return { allowed: true };
  }
  const claims = currentCredentialClaims();
  const tier = tierOverride ?? claims?.tier;

  // On a hosted deployment, free tier is restricted to links and YouTube embeds
  if (tier === "free") {
    return {
      allowed: false,
      reason:
        "File uploads require a Personal or Organization plan. You can still embed images from URLs or YouTube videos.",
      tier: "free",
    };
  }

  return tier ? { allowed: true, tier } : { allowed: true };
}
