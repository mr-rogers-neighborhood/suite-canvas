import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertionJson,
  base64UrlToBytes,
  bytesToBase64Url,
  type PasskeyRequestOptions,
  signInWithPasskey,
  toPublicKeyRequest,
} from "./passkey";

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer as ArrayBuffer;

/**
 * jsdom has no WebAuthn classes. They are stubs here on purpose: what this file
 * proves is our half — options in, public-credential JSON out — because the
 * server verifies the signature, the challenge and the origin.
 */
function stubWebAuthn(): void {
  vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
}

function assertion(userHandle = true) {
  return {
    id: "credential-id",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes(4, 5, 6),
      authenticatorData: bytes(7, 8, 9),
      signature: bytes(10, 11, 12),
      userHandle: userHandle ? bytes(13, 14, 15) : null,
    },
  } as unknown as PublicKeyCredential;
}

const options: PasskeyRequestOptions = {
  challenge: "aGVsbG8",
  rpId: "suite.example",
  userVerification: "preferred",
  allowCredentials: [{ id: "AQID" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("passkey encoding", () => {
  it("round-trips base64url, including the URL-safe characters", () => {
    const original = new Uint8Array([251, 255, 190, 0, 61, 62]);
    const encoded = bytesToBase64Url(original.buffer);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect([...base64UrlToBytes(encoded)]).toEqual([...original]);
  });

  it("hands the DOM bytes, not text", () => {
    const request = toPublicKeyRequest(options);
    // The DOM takes a BufferSource; a byte view of the decoded challenge is one.
    expect([...(request.challenge as Uint8Array)]).toEqual([...base64UrlToBytes("aGVsbG8")]);
    expect(request.allowCredentials?.[0]?.type).toBe("public-key");
    expect(request.userVerification).toBe("preferred");
  });

  it("asks for no credential list when the server offers none", () => {
    const request = toPublicKeyRequest({ challenge: "aGVsbG8" });
    expect(request.allowCredentials).toBeUndefined();
    // A preference is not a requirement: a device without a PIN can still sign in.
    expect(request.userVerification).toBe("preferred");
  });

  it("serialises the assertion the way the passkey server reads it", () => {
    const json = assertionJson(assertion());
    expect(json).toEqual({
      id: "credential-id",
      rawId: "AQID",
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: "BAUG",
        authenticatorData: "BwgJ",
        signature: "CgsM",
        userHandle: "DQ4P",
      },
    });
    // A platform authenticator may return no user handle; null is the truthful answer.
    expect(assertionJson(assertion(false))?.response.userHandle).toBeNull();
  });

  it("refuses a credential that is not an assertion", () => {
    expect(
      assertionJson({ id: "x", rawId: bytes(1), response: {} } as unknown as PublicKeyCredential),
    ).toBeNull();
  });
});

describe("passkey sign-in", () => {
  it("is unavailable where the browser has no WebAuthn at all", async () => {
    const result = await signInWithPasskey({
      requestOptions: async () => options,
      verify: async () => ({ ok: true }),
      credentials: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure).toBe("unsupported");
  });

  it("refuses to open a prompt when no passkey is registered", async () => {
    stubWebAuthn();
    const get = vi.fn();
    const result = await signInWithPasskey({
      requestOptions: async () => ({ challenge: "aGVsbG8", allowCredentials: [] }),
      verify: async () => ({ ok: true }),
      credentials: { get },
    });
    expect(result.ok === false && result.failure).toBe("not-registered");
    expect(get).not.toHaveBeenCalled();
  });

  it("says nothing changed when the prompt is dismissed", async () => {
    stubWebAuthn();
    const result = await signInWithPasskey({
      requestOptions: async () => options,
      verify: async () => ({ ok: true }),
      credentials: {
        get: async () => {
          throw new DOMException("dismissed", "NotAllowedError");
        },
      },
    });
    expect(result.ok === false && result.failure).toBe("cancelled");
    expect(result.ok === false && result.message).toContain("Nothing changed");
  });

  it("signs in when the server accepts the assertion", async () => {
    stubWebAuthn();
    const verified: unknown[] = [];
    const result = await signInWithPasskey({
      requestOptions: async () => options,
      verify: async (json) => {
        verified.push(json);
        return { ok: true };
      },
      credentials: { get: async () => assertion() },
    });
    expect(result).toEqual({ ok: true });
    expect((verified[0] as { id: string }).id).toBe("credential-id");
  });

  it("passes the server's reason through rather than inventing one", async () => {
    stubWebAuthn();
    const result = await signInWithPasskey({
      requestOptions: async () => options,
      verify: async () => ({ ok: false, message: "This passkey is not recognised." }),
      credentials: { get: async () => assertion() },
    });
    expect(result.ok === false && result.message).toBe("This passkey is not recognised.");
  });

  it("reports a missing account service without pretending the passkey failed", async () => {
    stubWebAuthn();
    const result = await signInWithPasskey({
      requestOptions: async () => null,
      verify: async () => ({ ok: true }),
      credentials: { get: async () => assertion() },
    });
    expect(result.ok === false && result.failure).toBe("unavailable");
  });
});
