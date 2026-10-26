import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LICENCE_FORMAT_VERSION,
  type LicenceClaims,
  signLicence,
  verifyBootLicence,
  verifyLicenceToken,
} from "./index.js";

/**
 * A keypair generated in this process. Nothing is committed, and the private
 * half never leaves the test.
 */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
const otherPem = otherPublicKey.export({ type: "spki", format: "pem" }).toString();

const ISSUED_AT = 1_800_000_000_000;
const EXPIRES_AT = ISSUED_AT + 30 * 24 * 60 * 60 * 1000;
const NOW = ISSUED_AT + 24 * 60 * 60 * 1000;

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: LICENCE_FORMAT_VERSION,
    id: "team-2026",
    tier: "team",
    workspaces: 25,
    documentBytes: 5 * 1024 * 1024,
    attachmentBytes: 25 * 1024 * 1024,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

/**
 * The boot path never consults `SUITE_HOSTED`. Every case runs with no
 * environment stubbed, which is exactly the state of a self-hosted relay.
 */
describe("boot licence", () => {
  it("verifies a token signed by the relay's key and reports its caps", () => {
    const token = signLicence(claims(), privatePem);

    expect(verifyBootLicence(token, publicPem, NOW)).toEqual({
      ok: true,
      licence: {
        claims: claims(),
        caps: { workspaces: 25, documentBytes: 5 * 1024 * 1024, attachmentBytes: 25 * 1024 * 1024 },
      },
    });
  });

  it("refuses an expired licence with licence-expired", () => {
    const token = signLicence(claims(), privatePem);
    const result = verifyBootLicence(token, publicPem, EXPIRES_AT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("licence-expired");
    expect(result.refusal.message).toContain("licence-expired");
    expect(result.refusal.message).not.toContain(token);
  });

  it("refuses a licence signed by another key with licence-bad-signature", () => {
    const token = signLicence(claims({ workspaces: 1_000_000 }), privatePem);
    const result = verifyBootLicence(token, otherPem, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("licence-bad-signature");
  });

  it("refuses a malformed token with licence-malformed", () => {
    for (const token of ["not-a-token", "a.b.c", "!!!.???", ""]) {
      const result = verifyBootLicence(token, publicPem, NOW);
      expect(result.ok, token).toBe(false);
      if (result.ok) continue;
      expect(result.refusal.code, token).toBe("licence-malformed");
    }
  });

  it("refuses a token the relay has no key for with licence-no-public-key", () => {
    const token = signLicence(claims(), privatePem);
    const result = verifyBootLicence(token, null, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("licence-no-public-key");
  });

  it("refuses a token from a future format with licence-unknown-version", () => {
    const token = signLicence(claims({ v: 2 }), privatePem);
    const result = verifyBootLicence(token, publicPem, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("licence-unknown-version");
  });
});

describe("verifyLicenceToken", () => {
  it("parses a token outside hosted mode, where verifyLicence never reaches it", () => {
    const token = signLicence(claims(), privatePem);

    expect(verifyLicenceToken(token, NOW, publicPem)).toEqual({ ok: true, claims: claims() });
    expect(verifyLicenceToken(token, EXPIRES_AT, publicPem)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
