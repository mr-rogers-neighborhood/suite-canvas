import { generateKeyPairSync } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LICENCE_FORMAT_VERSION,
  type LicenceClaims,
  signLicence,
  verifyLicence,
} from "./licence.js";

/**
 * A keypair generated in this process. Nothing is committed, and the private
 * half never leaves the test.
 */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// The relay only parses a token when it is hosted; without this every
// verification short-circuits to the self-hosted claims before signing.
beforeEach(() => {
  vi.stubEnv("SUITE_HOSTED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const claimsArb: fc.Arbitrary<LicenceClaims> = fc
  .record({
    v: fc.constant(LICENCE_FORMAT_VERSION),
    id: fc.stringMatching(/^[a-z][a-z0-9-]{0,23}$/u),
    tier: fc.constantFrom("hosted", "self-hosted", "trial"),
    workspaces: fc.integer({ min: 0, max: 10_000 }),
    documentBytes: fc.integer({ min: 0, max: 2 ** 32 }),
    attachmentBytes: fc.integer({ min: 0, max: 2 ** 32 }),
    issuedAt: fc.integer({ min: 0, max: 2 ** 40 }),
    lifetime: fc.integer({ min: 1, max: 2 ** 30 }),
    email: fc.option(fc.emailAddress(), { nil: undefined }),
  })
  .map(({ lifetime, email, ...rest }) => ({
    ...rest,
    expiresAt: rest.issuedAt + lifetime,
    ...(email === undefined ? {} : { email }),
  }));

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const TAMPER_CHARS = `${BASE64URL}.`;

/** One signed token plus a single-character edit of it, ready to verify. */
const tamperedTokenArb = claimsArb.chain((claims) => {
  const token = signLicence(claims, privatePem);
  return fc.tuple(
    fc.constant(claims),
    fc.constant(token),
    fc.nat({ max: token.length - 1 }),
    fc.constantFrom(...TAMPER_CHARS.split("")),
  );
});

describe("licence properties", () => {
  it("verifies its own signature and returns the payload unchanged", () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        const token = signLicence(claims, privatePem);

        expect(verifyLicence(token, claims.issuedAt, publicPem)).toEqual({ ok: true, claims });
      }),
      { numRuns: 60, verbose: true },
    );
  });

  it("rejects a token with any single character flipped", () => {
    fc.assert(
      fc.property(tamperedTokenArb, ([claims, token, position, replacement]) => {
        const original = token.charAt(position);
        // A no-op edit is not tampering; move to the next character in the
        // alphabet so the generated case always differs.
        const next =
          replacement === original
            ? TAMPER_CHARS.charAt((TAMPER_CHARS.indexOf(original) + 1) % TAMPER_CHARS.length)
            : replacement;
        const flipped = `${token.slice(0, position)}${next}${token.slice(position + 1)}`;

        expect(flipped).not.toBe(token);
        // The flip either breaks the signature or the base64url/segment shape;
        // both are refusals, and a refusal is the whole promise.
        const verification = verifyLicence(flipped, claims.issuedAt, publicPem);
        expect(verification.ok, flipped).toBe(false);
      }),
      { numRuns: 60, verbose: true },
    );
  });
});
