import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLicence,
  licenceStatus,
  licenceStorageKey,
  readLicence,
  storeLicence,
  verifyLicenceOffline,
} from "./licence";

/**
 * jsdom has no WebCrypto subtle, so the suite borrows Node's implementation.
 * `process.getBuiltinModule` avoids a Node import, which this package does not
 * type.
 */
const nodeCrypto = (
  globalThis as unknown as {
    process?: { getBuiltinModule?: (id: string) => { webcrypto: Crypto } };
  }
).process?.getBuiltinModule?.("node:crypto");
if (!nodeCrypto) throw new Error("node:crypto is unavailable in this test environment");
const webcrypto = nodeCrypto.webcrypto;

let privateKey: CryptoKey;
let publicKeyBase64: string;
let publicKeyPem: string;
let otherPublicKeyBase64: string;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (value.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pemOf(spki: Uint8Array): string {
  const base64 = toBase64(spki);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

const NOW = 1_800_000_000_000;
const ISSUED_AT = NOW - 60_000;
const EXPIRES_AT = NOW + 30 * 24 * 60 * 60 * 1000;

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: "lic-client-1",
    tier: "hosted",
    workspaces: 10,
    documentBytes: 1024,
    attachmentBytes: 2048,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

async function signToken(payload: Record<string, unknown> = claims()): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await webcrypto.subtle.sign({ name: "Ed25519" }, privateKey, bytes);
  return `${toBase64Url(bytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  privateKey = pair.privateKey;
  publicKeyBase64 = toBase64(
    new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)),
  );
  publicKeyPem = pemOf(new Uint8Array(await webcrypto.subtle.exportKey("spki", pair.publicKey)));

  const other = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  otherPublicKeyBase64 = toBase64(
    new Uint8Array(await webcrypto.subtle.exportKey("raw", other.publicKey)),
  );
});

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline verification", () => {
  it("verifies a token with a raw or PEM public key", async () => {
    const token = await signToken();
    const expected = expect.objectContaining({ id: "lic-client-1", workspaces: 10 });

    expect(await verifyLicenceOffline(token, publicKeyBase64, NOW)).toEqual({
      ok: true,
      claims: expected,
    });
    expect(await verifyLicenceOffline(token, publicKeyPem, NOW)).toEqual({
      ok: true,
      claims: expected,
    });
  });

  it("rejects a tampered payload", async () => {
    const token = await signToken();
    const [, signature = ""] = token.split(".");
    const tampered = `${toBase64Url(
      new TextEncoder().encode(JSON.stringify(claims({ workspaces: 100_000 }))),
    )}.${signature}`;

    expect(await verifyLicenceOffline(tampered, publicKeyBase64, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects a tampered signature", async () => {
    const token = await signToken();
    const [payload = "", signature = ""] = token.split(".");
    const bytes = fromBase64Url(signature);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    expect(
      await verifyLicenceOffline(`${payload}.${toBase64Url(bytes)}`, publicKeyBase64, NOW),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("reports expiry", async () => {
    const token = await signToken();
    expect(await verifyLicenceOffline(token, publicKeyBase64, EXPIRES_AT)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect((await verifyLicenceOffline(token, publicKeyBase64, EXPIRES_AT - 1)).ok).toBe(true);
  });

  it("reports an unknown version", async () => {
    const token = await signToken(claims({ v: 7 }));
    expect(await verifyLicenceOffline(token, publicKeyBase64, NOW)).toEqual({
      ok: false,
      reason: "unknown-version",
    });
  });

  it("rejects a token from a different signer", async () => {
    const token = await signToken();
    expect(await verifyLicenceOffline(token, otherPublicKeyBase64, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("reports malformed tokens and keys", async () => {
    const token = await signToken();
    expect(await verifyLicenceOffline("nonsense", publicKeyBase64, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyLicenceOffline("a.b.c", publicKeyBase64, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyLicenceOffline(token, "not a key", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("reports unsupported when the browser has no subtle crypto", async () => {
    const token = await signToken();
    vi.stubGlobal("crypto", {});
    expect(await verifyLicenceOffline(token, publicKeyBase64, NOW)).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("licence status", () => {
  it("explains a missing key", async () => {
    const report = await licenceStatus(null, publicKeyBase64, NOW);
    expect(report.status).toBe("missing");
    expect(report.sentence).toContain("hosted sync");
    expect(report.claims).toBeNull();
  });

  it("explains an active key", async () => {
    const report = await licenceStatus(await signToken(), publicKeyBase64, NOW);
    expect(report.status).toBe("active");
    expect(report.sentence).toContain("hosted");
    expect(report.sentence).toContain(new Date(EXPIRES_AT).toISOString().slice(0, 10));
    expect(report.claims?.workspaces).toBe(10);
  });

  it("explains an expired key and keeps the claims for the message", async () => {
    const report = await licenceStatus(await signToken(), publicKeyBase64, EXPIRES_AT + 1);
    expect(report.status).toBe("expired");
    expect(report.sentence).toContain("expired");
    expect(report.sentence).toContain(new Date(EXPIRES_AT).toISOString().slice(0, 10));
    expect(report.claims?.id).toBe("lic-client-1");
    expect(report.reason).toBe("expired");
  });

  it("explains an invalid key without blocking anything", async () => {
    const [payload = ""] = (await signToken()).split(".");
    const report = await licenceStatus(`${payload}.AAAA`, publicKeyBase64, NOW);
    expect(report.status).toBe("invalid");
    expect(report.sentence).toContain("could not be verified");
    expect(report.claims).toBeNull();
    expect(report.reason).toBe("bad-signature");
  });
});

describe("licence storage", () => {
  it("stores, reads and clears one workspace at a time", () => {
    expect(readLicence("ws-1")).toBeNull();
    expect(storeLicence("ws-1", "token-one")).toBe(true);
    expect(storeLicence("ws-2", "token-two")).toBe(true);

    expect(readLicence("ws-1")).toBe("token-one");
    expect(readLicence("ws-2")).toBe("token-two");
    expect(window.localStorage.getItem("suite.licence.ws-1")).toBe("token-one");
    expect(licenceStorageKey("ws-1")).toBe("suite.licence.ws-1");

    clearLicence("ws-1");
    expect(readLicence("ws-1")).toBeNull();
    expect(readLicence("ws-2")).toBe("token-two");
  });
});
