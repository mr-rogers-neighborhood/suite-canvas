import { createPrivateKey, sign } from "node:crypto";
import type { LicenceClaims } from "./claims.js";

/** Mints a token. Only the billing service, the operator tool and tests use this. */
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
