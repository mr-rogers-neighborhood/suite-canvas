import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedCredential,
  credentialAuthorization,
  credentialClaims,
  credentialIsFresh,
  currentCredentialClaims,
  forgetCredential,
  NO_CREDENTIAL_MESSAGE,
  REFRESH_MARGIN_MS,
  refreshCredential,
  relayCredential,
  relayCredentialBytes,
} from "./credential";

/** A JWT-shaped token with the claims the relay reads (ADR-0074). */
function token(overrides: Record<string, unknown> = {}, expiresInSeconds = 300): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  return [
    part({ alg: "EdDSA", typ: "JWT" }),
    part({
      sub: "user-1",
      org: "org-1",
      role: "owner",
      tier: "team",
      limits: { seats: 5, documentBytes: 2_147_483_648 },
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      ...overrides,
    }),
    "signature",
  ].join(".");
}

function mintResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  forgetCredential();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("credential claims", () => {
  it("reads exactly the fields the relay reads", () => {
    const claims = credentialClaims(token());
    expect(claims).toMatchObject({
      sub: "user-1",
      org: "org-1",
      role: "owner",
      tier: "team",
      limits: { seats: 5, documentBytes: 2_147_483_648 },
    });
    expect(claims?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("answers null rather than guessing for anything that is not a JWT", () => {
    expect(credentialClaims(null)).toBeNull();
    expect(credentialClaims("")).toBeNull();
    expect(credentialClaims("opaque-token")).toBeNull();
    expect(credentialClaims("a.b")).toBeNull();
    // A payload that is not JSON, and one with no subject.
    expect(credentialClaims(`a.${btoa("not json")}.c`)).toBeNull();
    const noSubject = [
      btoa("{}"),
      btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })),
      "sig",
    ].join(".");
    expect(credentialClaims(noSubject)).toBeNull();
  });

  it("treats a token inside the refresh margin as stale", () => {
    const nearlyDone = token({}, 30);
    expect(credentialIsFresh(nearlyDone)).toBe(false);
    expect(credentialIsFresh(token())).toBe(true);
    // The margin is a minute: a token with less than that left is refused early,
    // which is the point of refreshing ahead of a join.
    expect(credentialIsFresh(token({}, 45), Date.now(), REFRESH_MARGIN_MS)).toBe(false);
    expect(credentialIsFresh(token({}, 180), Date.now(), REFRESH_MARGIN_MS)).toBe(true);
  });
});

describe("minting", () => {
  it("trades the session cookie for a token and caches it", async () => {
    const fetchMock = vi.fn(async () => mintResponse({ token: token() }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await relayCredential();
    const second = await relayCredential();

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/token$/u);
    // The cookie is the thing being exchanged, and it never reaches script.
    expect(init.credentials).toBe("include");
    expect(cachedCredential()).toBe(first);
  });

  it("stops asking a deployment that has no mint endpoint", async () => {
    // A self-host running only the relay answers 404 forever. Asking once and
    // remembering it keeps a reconnect storm from firing a doomed request, and
    // keeps one 404 per gesture out of the console.
    const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await relayCredential()).toBeNull();
    expect(await relayCredential()).toBeNull();
    expect(await relayCredential()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a sign-in, which can create the endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await relayCredential()).toBeNull();

    // Signing in clears the memory, so a deployment that gained accounts is not
    // hidden behind a stale refusal.
    forgetCredential();
    expect(await relayCredential()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mints once for concurrent joins", async () => {
    const fetchMock = vi.fn(async () => mintResponse({ token: token() }));
    vi.stubGlobal("fetch", fetchMock);

    const all = await Promise.all([relayCredential(), relayCredential(), relayCredential()]);
    expect(new Set(all).size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mints again once the cached token is inside the margin", async () => {
    let exp = 30;
    const fetchMock = vi.fn(async () => mintResponse({ token: token({}, exp) }));
    vi.stubGlobal("fetch", fetchMock);

    // The first mint is already inside the margin, so it is refused and cached
    // as nothing.
    expect(await relayCredential()).toBeNull();
    exp = 300;
    expect(await relayCredential()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mints past the cache when a caller knows the claims have changed", async () => {
    // The claims carry the plan's limits, so a token minted before a payment argues with
    // the account that has just bought one. Waiting out the five minutes is the bug.
    let limits: Record<string, number> = { workspaces: 0 };
    const fetchMock = vi.fn(async () => mintResponse({ token: token({ limits }) }));
    vi.stubGlobal("fetch", fetchMock);

    await relayCredential();
    expect(currentCredentialClaims()?.limits).toEqual({ workspaces: 0 });
    limits = { workspaces: 3 };

    const refreshed = await refreshCredential();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(credentialClaims(refreshed)?.limits).toEqual({ workspaces: 3 });
    // And the cache now answers with the new one, so the join that follows sees it.
    expect(currentCredentialClaims()?.limits).toEqual({ workspaces: 3 });
  });

  it("keeps a superseded mint from putting the old claims back", async () => {
    // Two requests in the air, answered out of order: the one started first must not be
    // the one that lands in the cache.
    let releaseOld: () => void = () => {};
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
        return mintResponse({ token: token({ limits: { workspaces: 0 } }) });
      }
      return mintResponse({ token: token({ limits: { workspaces: 3 } }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const old = relayCredential();
    await Promise.resolve();
    const fresh = await refreshCredential();
    releaseOld();
    await old;

    expect(credentialClaims(fresh)?.limits).toEqual({ workspaces: 3 });
    expect(currentCredentialClaims()?.limits).toEqual({ workspaces: 3 });
  });

  it("answers null for every way a mint can fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({}, 401)),
    );
    expect(await relayCredential()).toBeNull();

    forgetCredential();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({ token: 42 })),
    );
    expect(await relayCredential()).toBeNull();

    forgetCredential();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await relayCredential()).toBeNull();

    forgetCredential();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({ token: "opaque" })),
    );
    expect(await relayCredential()).toBeNull();
  });
});

describe("presenting it", () => {
  it("builds the one header a relay call needs", async () => {
    const value = token();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({ token: value })),
    );

    expect(await credentialAuthorization()).toEqual({ authorization: `Bearer ${value}` });
    expect(currentCredentialClaims()?.tier).toBe("team");
  });

  it("refuses to send an anonymous request, with a sentence a reader can act on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({}, 401)),
    );

    await expect(credentialAuthorization()).rejects.toThrow(NO_CREDENTIAL_MESSAGE);
    expect(NO_CREDENTIAL_MESSAGE).toContain("Sign in");
  });

  it("hands the transport bytes, or nothing at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({ token: token() })),
    );
    const bytes = await relayCredentialBytes();
    // A view, not a realm-specific instance: jsdom and Node disagree on the
    // constructor and the transport only needs bytes.
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toContain(".");

    forgetCredential();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({}, 401)),
    );
    expect(await relayCredentialBytes()).toBeNull();
  });

  it("forgets the token on demand, so a sign-out leaves nothing behind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mintResponse({ token: token() })),
    );
    await relayCredential();
    expect(cachedCredential()).not.toBeNull();
    forgetCredential();
    expect(cachedCredential()).toBeNull();
    expect(currentCredentialClaims()).toBeNull();
  });
});
