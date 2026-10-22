import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAIM_TIMEOUT_MS,
  claimWorkspace,
  generateOwnerKey,
  OWNER_KEY_PREFIX,
  ownerKeyFromFragment,
  prepareOwnerSession,
  readOwnerKey,
  withOwnerFragment,
  writeOwnerKey,
} from "./ownerKey";

const API = "http://localhost:1235/api/workspaces/ws-1/claim";

function reply(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  } as Response;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("generateOwnerKey", () => {
  it("returns 32 random bytes as base64url", () => {
    const key = generateOwnerKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOwnerKey()).not.toBe(key);
  });
});

describe("owner key storage", () => {
  it("round-trips a key under the workspace prefix", () => {
    expect(readOwnerKey("ws-1")).toBeNull();
    writeOwnerKey("ws-1", "owner-key");
    expect(readOwnerKey("ws-1")).toBe("owner-key");
    expect(window.localStorage.getItem(`${OWNER_KEY_PREFIX}ws-1`)).toBe("owner-key");
    expect(readOwnerKey("ws-2")).toBeNull();
  });

  it("ignores blank keys and workspaces", () => {
    writeOwnerKey("ws-1", "   ");
    expect(readOwnerKey("ws-1")).toBeNull();
    writeOwnerKey("", "owner-key");
    expect(window.localStorage.getItem(`${OWNER_KEY_PREFIX}`)).toBeNull();
  });
});

describe("owner fragment", () => {
  it("reads #owner= and ignores anything else", () => {
    expect(ownerKeyFromFragment("#owner=abc-123")).toBe("abc-123");
    expect(ownerKeyFromFragment("owner=abc-123")).toBe("abc-123");
    expect(ownerKeyFromFragment("#board=b1")).toBeNull();
    expect(ownerKeyFromFragment("#owner=")).toBeNull();
    expect(ownerKeyFromFragment("")).toBeNull();
  });

  it("replaces the hash while keeping the query", () => {
    const url = withOwnerFragment("http://localhost/?workspace=ws-1&board=b1#old", "abc-123");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("workspace")).toBe("ws-1");
    expect(parsed.searchParams.get("board")).toBe("b1");
    expect(parsed.hash).toBe("#owner=abc-123");
  });
});

describe("claimWorkspace", () => {
  it("posts the key and reports a claim", async () => {
    const fetchMock = stubFetch(() => reply(200));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("claimed");

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(API);
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ ownerKey: "owner-key" });
    expect(call?.[1]?.signal).toBeDefined();
    expect(CLAIM_TIMEOUT_MS).toBe(2500);
  });

  it("reports a conflict for 409", async () => {
    stubFetch(() => reply(409));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("conflict");
  });

  it("reports offline for network and server failures", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("offline");

    stubFetch(() => reply(500));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("offline");
  });
});

describe("prepareOwnerSession", () => {
  it("generates and stores a key for a workspace with none", async () => {
    const fetchMock = stubFetch(() => reply(200));

    const session = await prepareOwnerSession("ws-1");

    expect(session.claim).toBe("claimed");
    expect(session.ownerKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readOwnerKey("ws-1")).toBe(session.ownerKey);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.ownerKey).toBe(session.ownerKey);
  });

  it("prefers a stored key over generating one", async () => {
    writeOwnerKey("ws-1", "stored-key");
    const fetchMock = stubFetch(() => reply(200));

    const session = await prepareOwnerSession("ws-1");

    expect(session).toEqual({ ownerKey: "stored-key", claim: "claimed" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ownerKey: "stored-key",
    });
  });

  it("prefers an explicit fragment key and keeps it for next time", async () => {
    window.history.replaceState({}, "", "/?workspace=ws-1#owner=fragment-key");
    writeOwnerKey("ws-1", "stored-key");
    const fetchMock = stubFetch(() => reply(200));

    const session = await prepareOwnerSession("ws-1");

    expect(session).toEqual({ ownerKey: "fragment-key", claim: "claimed" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ownerKey: "fragment-key",
    });
    expect(readOwnerKey("ws-1")).toBe("fragment-key");
  });

  it("keeps the fragment and stored key on a conflict", async () => {
    window.history.replaceState({}, "", "/?workspace=ws-1#owner=fragment-key");
    writeOwnerKey("ws-1", "stored-key");
    stubFetch(() => reply(409));

    const session = await prepareOwnerSession("ws-1");

    expect(session).toEqual({ ownerKey: "fragment-key", claim: "conflict" });
    expect(window.location.hash).toBe("#owner=fragment-key");
    expect(readOwnerKey("ws-1")).toBe("stored-key");
  });

  it("continues local-first when the claim is offline", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));

    const session = await prepareOwnerSession("ws-1");

    expect(session.claim).toBe("offline");
    expect(readOwnerKey("ws-1")).toBe(session.ownerKey);
  });
});
