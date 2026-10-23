import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAIM_RETRY_DELAYS_MS,
  CLAIM_TIMEOUT_MS,
  type ClaimEvent,
  type ClaimOutcome,
  type ClaimState,
  claimOutcome,
  claimWorkspace,
  deriveOwnerKey,
  generateOwnerKey,
  isClaimRetryable,
  isClaimSettled,
  mayWriteWorkspace,
  nextClaimState,
  normalizePassphrase,
  OWNER_KEY_PREFIX,
  ownerKeyFromFragment,
  PASSPHRASE_ITERATIONS,
  PASSPHRASE_MIN_CHARS,
  PASSPHRASE_MIN_WORDS,
  passphraseProblem,
  prepareOwnerSession,
  readClaimRecord,
  readOwnerKey,
  recordClaimOutcome,
  rotateOwnerKey,
  startClaimRetry,
  stopAllClaimRetries,
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

/** Lets every already-resolved promise in the claim chain run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function goOffline(offline: boolean): void {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(!offline);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  stopAllClaimRetries();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe("claimOutcome", () => {
  it("treats an accepted claim as ownership", () => {
    expect(claimOutcome({ kind: "response", status: 200 })).toBe("claimed");
    expect(claimOutcome({ kind: "response", status: 201 })).toBe("claimed");
  });

  it("treats 409 as the workspace being owned by another key", () => {
    expect(claimOutcome({ kind: "response", status: 409 })).toBe("conflict");
  });

  it("keeps a failed attempt pending: rejected fetch, timeout, 5xx, throttling", () => {
    expect(claimOutcome({ kind: "network-error" })).toBe("pending");
    expect(claimOutcome({ kind: "timeout" })).toBe("pending");
    expect(claimOutcome({ kind: "response", status: 500 })).toBe("pending");
    expect(claimOutcome({ kind: "response", status: 503 })).toBe("pending");
    expect(claimOutcome({ kind: "response", status: 429 })).toBe("pending");
    expect(claimOutcome({ kind: "response", status: 408 })).toBe("pending");
    // A 3xx the browser did not follow is not an answer either.
    expect(claimOutcome({ kind: "response", status: 302 })).toBe("pending");
  });

  it("reports offline only when the browser knows it has no network", () => {
    expect(claimOutcome({ kind: "no-network" })).toBe("offline");
  });

  it("treats a definitive refusal of this key as a conflict", () => {
    expect(claimOutcome({ kind: "response", status: 400 })).toBe("conflict");
    expect(claimOutcome({ kind: "response", status: 401 })).toBe("conflict");
    expect(claimOutcome({ kind: "response", status: 403 })).toBe("conflict");
    expect(claimOutcome({ kind: "response", status: 404 })).toBe("conflict");
  });
});

describe("claim machine", () => {
  it("walks unclaimed → claiming → pending → claiming → claimed", () => {
    let state: ClaimState = "unclaimed";
    state = nextClaimState(state, { type: "attempt" });
    expect(state).toBe("claiming");

    state = nextClaimState(state, { type: "outcome", outcome: "pending" });
    expect(state).toBe("pending");
    expect(isClaimRetryable(state)).toBe(true);
    expect(isClaimSettled(state)).toBe(false);
    expect(mayWriteWorkspace(state)).toBe(false);

    state = nextClaimState(state, { type: "online" });
    expect(state).toBe("claiming");

    state = nextClaimState(state, { type: "outcome", outcome: "claimed" });
    expect(state).toBe("claimed");
    expect(isClaimSettled(state)).toBe(true);
    expect(isClaimRetryable(state)).toBe(false);
    expect(mayWriteWorkspace(state)).toBe(true);
  });

  it("never claims from a network failure or a skipped attempt", () => {
    expect(
      nextClaimState("claiming", { type: "outcome", outcome: claimOutcome({ kind: "timeout" }) }),
    ).toBe("pending");
    expect(
      nextClaimState("claiming", {
        type: "outcome",
        outcome: claimOutcome({ kind: "no-network" }),
      }),
    ).toBe("offline");
    expect(mayWriteWorkspace("offline")).toBe(false);
    expect(mayWriteWorkspace("pending")).toBe(false);
  });

  it("only retries states that failed", () => {
    expect(nextClaimState("pending", { type: "retry" })).toBe("claiming");
    expect(nextClaimState("offline", { type: "retry" })).toBe("claiming");
    expect(nextClaimState("offline", { type: "online" })).toBe("claiming");
    // An in-flight claim already owns the attempt, and a fresh boot has not
    // tried yet.
    expect(nextClaimState("claiming", { type: "online" })).toBe("claiming");
    expect(nextClaimState("unclaimed", { type: "retry" })).toBe("unclaimed");
  });

  it("treats claimed and conflict as terminal", () => {
    const events: ClaimEvent[] = [
      { type: "attempt" },
      { type: "outcome", outcome: "pending" },
      { type: "online" },
      { type: "retry" },
    ];
    for (const event of events) {
      expect(nextClaimState("claimed", event)).toBe("claimed");
      expect(nextClaimState("conflict", event)).toBe("conflict");
    }
    expect(mayWriteWorkspace("conflict")).toBe(false);
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

  it("is idempotent: claiming twice with the same key succeeds twice", async () => {
    const fetchMock = stubFetch(() => reply(200));

    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("claimed");
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("claimed");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toEqual({ ownerKey: "owner-key" });
    }
  });

  it("reports a conflict for 409", async () => {
    stubFetch(() => reply(409));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("conflict");
  });

  it("keeps network and server failures pending", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("pending");

    stubFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("pending");

    stubFetch(() => reply(500));
    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("pending");
  });

  it("never asks the relay when the browser is offline", async () => {
    const fetchMock = stubFetch(() => reply(200));
    goOffline(true);

    await expect(claimWorkspace("ws-1", "owner-key")).resolves.toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("claim record", () => {
  it("remembers a claim and a pending attempt, and keeps the record on a conflict", () => {
    expect(readClaimRecord("ws-1")).toBeNull();

    recordClaimOutcome("ws-1", "claimed");
    expect(readClaimRecord("ws-1")).toBe("claimed");

    recordClaimOutcome("ws-1", "pending");
    expect(readClaimRecord("ws-1")).toBe("pending");

    recordClaimOutcome("ws-1", "conflict");
    expect(readClaimRecord("ws-1")).toBe("pending");
  });

  it("marks a failed attempt pending even when the device owned it before", () => {
    recordClaimOutcome("ws-1", "claimed");
    recordClaimOutcome("ws-1", "offline");
    expect(readClaimRecord("ws-1")).toBe("pending");
  });
});

describe("startClaimRetry", () => {
  it("retries on online and stops after success", async () => {
    const fetchMock = stubFetch(() => reply(200));
    const outcomes: ClaimOutcome[] = [];
    startClaimRetry("ws-1", "owner-key", {
      delays: [10_000],
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    // The boot attempt already ran; the loop waits for a reconnect or the timer.
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("online"));
    await settle();

    expect(outcomes).toEqual(["claimed"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readClaimRecord("ws-1")).toBe("claimed");

    // Settled loops are gone, listener included.
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on the backoff and keeps the claim pending while the relay is down", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(() => Promise.reject(new Error("offline")));
    const outcomes: ClaimOutcome[] = [];

    startClaimRetry("ws-1", "owner-key", {
      delays: [10, 20],
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    expect(CLAIM_RETRY_DELAYS_MS.at(-1)).toBe(60_000);

    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The last delay repeats: the loop stays cheap but never gives up.
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcomes).toEqual(["pending", "pending", "pending"]);
    expect(outcomes).not.toContain("claimed");
    expect(readClaimRecord("ws-1")).toBe("pending");
  });

  it("a pending claim never becomes claimed on a network error", async () => {
    const outcomes: ClaimOutcome[] = [];
    stubFetch(() => Promise.reject(new Error("offline")));
    startClaimRetry("ws-1", "owner-key", { onOutcome: (outcome) => outcomes.push(outcome) });

    window.dispatchEvent(new Event("online"));
    await settle();

    expect(outcomes).toEqual(["pending"]);
    expect(readClaimRecord("ws-1")).toBe("pending");
  });

  it("stops on a conflict and leaves the record that explains it", async () => {
    vi.useFakeTimers();
    recordClaimOutcome("ws-1", "pending");
    const fetchMock = stubFetch(() => reply(409));
    const outcomes: ClaimOutcome[] = [];

    startClaimRetry("ws-1", "owner-key", {
      delays: [10],
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(outcomes).toEqual(["conflict"]);
    expect(readClaimRecord("ws-1")).toBe("pending");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops when told to", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(() => reply(200));
    const stop = startClaimRetry("ws-1", "owner-key", { delays: [10] });

    stop();
    window.dispatchEvent(new Event("online"));
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("prepareOwnerSession", () => {
  it("generates and stores a key for a workspace with none", async () => {
    const fetchMock = stubFetch(() => reply(200));

    const session = await prepareOwnerSession("ws-1");

    expect(session.claim).toBe("claimed");
    expect(session.retrying).toBe(false);
    expect(session.ownerKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readOwnerKey("ws-1")).toBe(session.ownerKey);
    expect(readClaimRecord("ws-1")).toBe("claimed");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.ownerKey).toBe(session.ownerKey);
  });

  it("prefers a stored key over generating one", async () => {
    writeOwnerKey("ws-1", "stored-key");
    const fetchMock = stubFetch(() => reply(200));

    const session = await prepareOwnerSession("ws-1");

    expect(session).toEqual({ ownerKey: "stored-key", claim: "claimed", retrying: false });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ownerKey: "stored-key",
    });
  });

  it("prefers an explicit fragment key and keeps it for next time", async () => {
    window.history.replaceState({}, "", "/?workspace=ws-1#owner=fragment-key");
    writeOwnerKey("ws-1", "stored-key");
    const fetchMock = stubFetch(() => reply(200));

    const session = await prepareOwnerSession("ws-1");

    expect(session).toEqual({ ownerKey: "fragment-key", claim: "claimed", retrying: false });
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

    expect(session).toEqual({ ownerKey: "fragment-key", claim: "conflict", retrying: false });
    expect(window.location.hash).toBe("#owner=fragment-key");
    expect(readOwnerKey("ws-1")).toBe("stored-key");
  });

  it("continues local-first and starts a retry when the claim is pending", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));

    const session = await prepareOwnerSession("ws-1");

    expect(session.claim).toBe("pending");
    expect(session.retrying).toBe(true);
    expect(readOwnerKey("ws-1")).toBe(session.ownerKey);
    expect(readClaimRecord("ws-1")).toBe("pending");
    // The key survives: the next boot — or the retry — claims with it.
    expect(session.ownerKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not retry a conflict", async () => {
    stubFetch(() => reply(409));

    const session = await prepareOwnerSession("ws-1");

    expect(session.claim).toBe("conflict");
    expect(session.retrying).toBe(false);
  });
});

describe("rotateOwnerKey", () => {
  it("posts the new key with the current key in the Authorization header", async () => {
    const fetchMock = stubFetch(() => reply(200));

    await rotateOwnerKey("ws-1", "old-key", "new-key");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:1235/api/workspaces/ws-1/rotate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ newOwnerKey: "new-key" }));
    expect(init?.headers).toMatchObject({ authorization: "Bearer old-key" });
    // The key never travels in the URL.
    expect(String(url)).not.toContain("old-key");
  });

  it("turns a refused rotation into a readable error", async () => {
    stubFetch(
      () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({ error: "The current owner key does not match this workspace." }),
        }) as Response,
    );

    await expect(rotateOwnerKey("ws-1", "wrong", "new-key")).rejects.toThrow(
      "The current owner key does not match this workspace.",
    );
  });

  it("explains an unreachable server", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));

    await expect(rotateOwnerKey("ws-1", "old-key", "new-key")).rejects.toThrow(
      "Could not reach the workspace server",
    );
  });
});

const PASSPHRASE = "velvet otter lantern meadow";

function hexOf(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  return hexOf(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

describe("deriveOwnerKey", () => {
  it("derives the same key from the same passphrase and workspace on any device", async () => {
    const first = await deriveOwnerKey(PASSPHRASE, "ws-1");
    const again = await deriveOwnerKey(`  ${PASSPHRASE.toUpperCase()}  `, "ws-1");

    expect(again).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    // The relay only ever sees the hash of this shape of key.
    expect(await sha256(first)).toHaveLength(64);
  });

  it("derives a different key for a different workspace", async () => {
    const here = await deriveOwnerKey(PASSPHRASE, "ws-1");
    const elsewhere = await deriveOwnerKey(PASSPHRASE, "ws-2");

    expect(elsewhere).not.toBe(here);
  });

  it("uses at least the 600 000 iteration PBKDF2 floor", () => {
    expect(PASSPHRASE_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("normalizes case and spacing so a retyped passphrase still opens the workspace", () => {
    expect(normalizePassphrase("  Red   Otter\nLantern  ")).toBe("red otter lantern");
  });

  it("refuses to derive from nothing", async () => {
    await expect(deriveOwnerKey("   ", "ws-1")).rejects.toThrow("Enter a passphrase");
    await expect(deriveOwnerKey(PASSPHRASE, "  ")).rejects.toThrow("workspace id");
  });
});

describe("passphraseProblem", () => {
  it("accepts four unrelated words", () => {
    expect(passphraseProblem(PASSPHRASE)).toBeNull();
    expect(passphraseProblem("Otto builds tiny rockets at midnight")).toBeNull();
  });

  it("explains an empty passphrase", () => {
    expect(passphraseProblem("")).toContain("at least four words");
  });

  it("explains a passphrase that is short in both words and characters", () => {
    expect(passphraseProblem("cat dog")).toContain(
      `at least ${PASSPHRASE_MIN_WORDS} words and ${PASSPHRASE_MIN_CHARS} characters`,
    );
    expect(passphraseProblem("cat dog")).toContain("2 words and 7 characters");
  });

  it("explains a long passphrase with too few words", () => {
    expect(passphraseProblem("extraordinarily complicated")).toContain("Add 2 more words");
  });

  it("explains a four-word passphrase that is still too short", () => {
    expect(passphraseProblem("ant bee cow dog")).toContain("That is 15 characters");
  });

  it("refuses a word repeated four times", () => {
    expect(passphraseProblem("word word word word")).toContain("4 different words");
  });

  it("refuses a famous first guess", () => {
    expect(passphraseProblem("correct horse battery staple")).toContain(
      "first passphrases anyone guessing would try",
    );
  });

  it("refuses digits alone", () => {
    expect(passphraseProblem("1234 5678 9012 3456")).toContain("Use words, not only digits");
  });

  it("refuses one character hammered out", () => {
    expect(passphraseProblem("aaaaaa bbbbbb cccccc dddddd")).toContain("repeated many times");
  });
});

describe("a passphrase key through the existing rotation helpers", () => {
  it("replaces the old key, so only the derived key can still claim the workspace", async () => {
    const oldKey = generateOwnerKey();
    let storedHash = await sha256(oldKey);

    const fetchMock = stubFetch(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
      if (url.endsWith("/rotate")) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const presented = (headers.authorization ?? "").split(" ").at(-1) ?? "";
        if ((await sha256(presented)) !== storedHash) return reply(403);
        storedHash = await sha256(body.newOwnerKey ?? "");
        return reply(200);
      }
      return reply((await sha256(body.ownerKey ?? "")) === storedHash ? 200 : 409);
    });

    expect(await claimWorkspace("ws-1", oldKey)).toBe("claimed");

    const derived = await deriveOwnerKey(PASSPHRASE, "ws-1");
    expect(derived).not.toBe(oldKey);
    await rotateOwnerKey("ws-1", oldKey, derived);

    // The derived key is the owner now; the old key and its old file are not.
    expect(await claimWorkspace("ws-1", derived)).toBe("claimed");
    expect(await claimWorkspace("ws-1", oldKey)).toBe("conflict");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/rotate"))).toBe(true);
  });
});
