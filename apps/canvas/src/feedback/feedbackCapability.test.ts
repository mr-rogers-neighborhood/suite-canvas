import { afterEach, describe, expect, it, vi } from "vitest";

// A standalone build is what the desktop shell runs, so this is the case that
// decides whether every local session logs a failed request.
vi.mock("../session/mode", () => ({ isStandalone: () => true }));

const { feedbackAvailable, feedbackCapability } = await import("./feedbackClient");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("feedback capability in a standalone build", () => {
  it("does not ask the network at all", async () => {
    // The real call path: no base, no injected fetch, so anything that leaves the
    // process would go through the global.
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await feedbackCapability()).toEqual({ configured: false, captcha: false });
    expect(fetch).not.toHaveBeenCalled();

    expect(await feedbackAvailable()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still honours an injected fetch, so a test is not silently disabled", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ configured: true, captcha: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
    expect(await feedbackCapability({ fetch })).toEqual({ configured: true, captcha: false });
  });
});
