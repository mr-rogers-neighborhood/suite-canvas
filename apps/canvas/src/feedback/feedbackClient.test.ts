import { describe, expect, it } from "vitest";
import { feedbackAvailable, sendFeedback } from "./feedbackClient";

function answer(status: number, body: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

describe("the feedback client", () => {
  it("asks whether the deployment takes feedback", async () => {
    expect(await feedbackAvailable({ fetch: answer(200, { ok: true, configured: true }) })).toBe(
      true,
    );
    expect(await feedbackAvailable({ fetch: answer(200, { ok: true, configured: false }) })).toBe(
      false,
    );
    expect(await feedbackAvailable({ fetch: answer(503, {}) })).toBe(false);
  });

  it("is unavailable rather than thrown when the server is not there", async () => {
    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(await feedbackAvailable({ fetch })).toBe(false);
  });

  it("names the rate limit as its own failure", async () => {
    const outcome = await sendFeedback({
      text: "hi",
      surface: "board",
      signedIn: false,
      fetch: answer(429, { ok: false, message: "That is a few messages already." }),
    });
    expect(outcome).toMatchObject({ ok: false, reason: "rate-limited" });
  });

  it("never reports success for a message that did not send", async () => {
    const refused = await sendFeedback({
      text: "hi",
      surface: "board",
      signedIn: false,
      fetch: answer(502, { ok: false, message: "The message did not send." }),
    });
    expect(refused.ok).toBe(false);

    const offline = await sendFeedback({
      text: "hi",
      surface: "board",
      signedIn: false,
      fetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof globalThis.fetch,
    });
    expect(offline).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
