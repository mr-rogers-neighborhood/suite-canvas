import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LICENCE_FORMAT_VERSION,
  type LicenceClaims,
  licencePublicKey,
  licenceQuota,
  licenceRequired,
  signLicence,
  UNLIMITED_QUOTA,
  verifyLicence,
} from "./licence.js";

/**
 * A fixed keypair generated when the suite runs. Nothing is committed, and the
 * private half only ever exists in this process.
 */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");

const ISSUED_AT = 1_800_000_000_000;
const EXPIRES_AT = ISSUED_AT + 30 * 24 * 60 * 60 * 1000;
const NOW = ISSUED_AT + 24 * 60 * 60 * 1000;

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: LICENCE_FORMAT_VERSION,
    id: "lic-test-1",
    tier: "hosted",
    workspaces: 25,
    documentBytes: 5 * 1024 * 1024,
    attachmentBytes: 25 * 1024 * 1024,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    email: "ops@example.com",
    ...overrides,
  };
}

function rawBase64(key: KeyObject): string {
  const der = Buffer.from(key.export({ type: "spki", format: "der" }));
  return der.subarray(12).toString("base64");
}

function payloadOf(token: string): Record<string, unknown> {
  const [payload = ""] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function withPayload(token: string, payload: Record<string, unknown>): string {
  const signature = token.split(".")[1] ?? "";
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;
}

beforeEach(() => {
  vi.stubEnv("SUITE_HOSTED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("licence tokens", () => {
  it("round-trips a signed licence", () => {
    const token = signLicence(claims(), privatePem);
    const result = verifyLicence(token, NOW, publicPem);

    expect(result).toEqual({ ok: true, claims: claims() });
    expect(token).not.toContain("=");
    expect(token.split(".")).toHaveLength(2);
  });

  it("accepts the public key as bare base64 as well as PEM", () => {
    const token = signLicence(claims(), privatePem);
    const raw = rawBase64(publicKey);
    expect(verifyLicence(token, NOW, raw)).toEqual({ ok: true, claims: claims() });
  });

  it("rejects a tampered payload with a signature failure", () => {
    const token = signLicence(claims(), privatePem);
    const tampered = withPayload(token, { ...payloadOf(token), documentBytes: 1 });

    expect(verifyLicence(tampered, NOW, publicPem)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a tampered signature", () => {
    const token = signLicence(claims(), privatePem);
    const [payload = "", signature = ""] = token.split(".");
    const bytes = Buffer.from(signature, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = `${payload}.${bytes.toString("base64url")}`;

    expect(verifyLicence(tampered, NOW, publicPem)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects an expired licence", () => {
    const token = signLicence(claims(), privatePem);
    expect(verifyLicence(token, EXPIRES_AT, publicPem)).toEqual({ ok: false, reason: "expired" });
    expect(verifyLicence(token, EXPIRES_AT - 1, publicPem).ok).toBe(true);
  });

  it("rejects a token signed by another key", () => {
    const token = signLicence(claims(), privatePem);
    const otherPem = otherPublicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyLicence(token, NOW, otherPem)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("reports an unknown format version", () => {
    const token = signLicence(claims({ v: 2 }), privatePem);
    expect(verifyLicence(token, NOW, publicPem)).toEqual({
      ok: false,
      reason: "unknown-version",
    });
  });

  it("reports malformed tokens", () => {
    const cases: unknown[] = [
      "",
      "not-a-token",
      "a.b.c",
      "!!!.???",
      Buffer.from("{}", "utf8").toString("base64url"),
      42,
      null,
      undefined,
    ];
    for (const value of cases) {
      expect(verifyLicence(value, NOW, publicPem)).toEqual({ ok: false, reason: "malformed" });
    }

    const notJson = `${Buffer.from("nope", "utf8").toString("base64url")}.${Buffer.alloc(64).toString("base64url")}`;
    expect(verifyLicence(notJson, NOW, publicPem)).toEqual({ ok: false, reason: "malformed" });
  });

  it("reports a missing relay key", () => {
    const token = signLicence(claims(), privatePem);
    expect(verifyLicence(token, NOW, null)).toEqual({ ok: false, reason: "no-public-key" });
  });

  it("maps claims to the quota the relay enforces", () => {
    expect(licenceQuota(claims())).toEqual({
      workspaces: 25,
      documentBytes: 5 * 1024 * 1024,
      attachmentBytes: 25 * 1024 * 1024,
    });
  });
});

describe("self-host inertness", () => {
  it("requires no licence when SUITE_HOSTED is unset", () => {
    vi.unstubAllEnvs();
    expect(licenceRequired()).toBe(false);
  });

  it("requires a licence only when SUITE_HOSTED is exactly 1", () => {
    vi.stubEnv("SUITE_HOSTED", "true");
    expect(licenceRequired()).toBe(false);
    vi.stubEnv("SUITE_HOSTED", "1");
    expect(licenceRequired()).toBe(true);
  });

  it("never parses a token and never fails verification on a self-host", () => {
    vi.unstubAllEnvs();
    expect(verifyLicence("anything at all", NOW, null)).toEqual({
      ok: true,
      claims: expect.objectContaining({ id: "self-hosted" }),
    });
    expect(verifyLicence(undefined, NOW, "not a key").ok).toBe(true);
  });

  it("reports unlimited quota and no configured key on a self-host", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("SUITE_LICENCE_PUBLIC_KEY", publicPem);
    expect(licencePublicKey()).toBeNull();
    expect(licenceQuota(claims())).toEqual(UNLIMITED_QUOTA);
    expect(licenceQuota(claims()).workspaces).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads the relay key from the environment when hosted", () => {
    vi.stubEnv("SUITE_LICENCE_PUBLIC_KEY", "  ");
    expect(licencePublicKey()).toBeNull();
    vi.stubEnv("SUITE_LICENCE_PUBLIC_KEY", publicPem);
    expect(licencePublicKey()).toBe(publicPem.trim());
  });
});
