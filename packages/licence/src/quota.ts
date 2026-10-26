import type { LicenceClaims } from "./claims.js";
import { licenceRequired } from "./environment.js";

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

/** The caps a claims object carries. No environment, so a boot licence uses it too. */
export function claimsQuota(claims: LicenceClaims): LicenceQuota {
  return {
    workspaces: claims.workspaces,
    documentBytes: claims.documentBytes,
    attachmentBytes: claims.attachmentBytes,
  };
}

/** Caps the relay should enforce. Inert — and therefore unlimited — on a self-host. */
export function licenceQuota(claims: LicenceClaims): LicenceQuota {
  if (!licenceRequired()) return UNLIMITED_QUOTA;
  return claimsQuota(claims);
}
