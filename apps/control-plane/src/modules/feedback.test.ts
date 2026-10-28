import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { createFeedbackModule, FEEDBACK_PER_WINDOW } from "./feedback.js";

/**
 * The one public route that spends money for an unauthenticated caller.
 *
 * What matters is that it cannot be used as a relay: a cap per address, a cap on
 * the body, and no false thanks when the transport fails.
 */
function silence() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
}

function request(
  method: string,
  body: string | null,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    method,
    url: "/api/feedback",
    headers,
    socket: { remoteAddress: "10.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (body !== null) yield Buffer.from(body, "utf8");
    },
  } as unknown as IncomingMessage;
}

function response() {
  const out = { status: 0, body: "", headers: {} as Record<string, unknown> };
  const res = {
    setHeader: (name: string, value: unknown) => {
      out.headers[name.toLowerCase()] = value;
    },
    writeHead: (status: number) => {
      out.status = status;
      return res;
    },
    write: (chunk: string) => {
      out.body += chunk;
      return true;
    },
    end: (chunk?: string) => {
      if (chunk !== undefined) out.body += chunk;
    },
  };
  return { out, res: res as never };
}

function moduleWith(
  overrides: {
    to?: string;
    fail?: boolean;
    now?: () => number;
    turnstileSecret?: string;
    captcha?: boolean;
  } = {},
) {
  const sent: { text: string; surface: string; signedIn: boolean }[] = [];
  const asked: string[] = [];
  const module = createFeedbackModule({
    env: {
      SUITE_FEEDBACK_TO: overrides.to ?? "desk@example.com",
      SUITE_VERSION: "v1.2.3",
      ...(overrides.turnstileSecret === undefined
        ? {}
        : { SUITE_TURNSTILE_SECRET: overrides.turnstileSecret }),
    },
    logger: silence(),
    now: overrides.now ?? (() => 1_000_000),
    send: async (message) => {
      if (overrides.fail === true) throw new Error("transport down");
      sent.push(message);
    },
    verifyCaptcha: async (token) => {
      asked.push(token);
      return overrides.captcha ?? true;
    },
  });
  return { module, sent, asked };
}

const post = (
  text: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) => request("POST", JSON.stringify({ text, surface: "board", signedIn: true, ...extra }), headers);

describe("the feedback route", () => {
  it("answers only its own path", async () => {
    const { module } = moduleWith();
    const { res } = response();
    expect(
      await module.handle({ method: "GET", url: "/health", headers: {} } as IncomingMessage, res),
    ).toBe(false);
  });

  it("tells the client whether it is configured, so the bubble can hide", async () => {
    const unset = moduleWith({ to: "" });
    const one = response();
    await unset.module.handle(request("GET", null), one.res);
    expect(JSON.parse(one.out.body)).toEqual({ ok: true, configured: false, captcha: false });

    const set = moduleWith();
    const two = response();
    await set.module.handle(request("GET", null), two.res);
    expect(JSON.parse(two.out.body)).toEqual({ ok: true, configured: true, captcha: false });
  });

  it("sends the words and the context, and never the document", async () => {
    const { module, sent } = moduleWith();
    const { out, res } = response();
    await module.handle(post("the sync panel confused me"), res);

    expect(out.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      text: "the sync panel confused me",
      surface: "board",
      signedIn: true,
    });
  });

  it("caps one address rather than one message", async () => {
    const { module, sent } = moduleWith();
    for (let i = 0; i < FEEDBACK_PER_WINDOW; i += 1) {
      const { out, res } = response();
      await module.handle(post(`message ${i}`), res);
      expect(out.status).toBe(200);
    }
    const { out, res } = response();
    await module.handle(post("one too many"), res);
    expect(out.status).toBe(429);
    expect(out.headers["retry-after"]).toBeDefined();
    expect(sent).toHaveLength(FEEDBACK_PER_WINDOW);
  });

  it("refuses an empty or oversized message before it costs a send", async () => {
    const { module, sent } = moduleWith();
    const empty = response();
    await module.handle(post("   "), empty.res);
    expect(empty.out.status).toBe(400);

    const huge = response();
    await module.handle(post("x".repeat(4001)), huge.res);
    expect(huge.out.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("says it failed rather than thanking the sender for nothing", async () => {
    const { module } = moduleWith({ fail: true });
    const { out, res } = response();
    await module.handle(post("hello"), res);
    expect(out.status).toBe(502);
    expect(JSON.parse(out.body)).toMatchObject({ ok: false, error: "feedback-failed" });
  });

  it("refuses to accept a message when no desk is configured", async () => {
    const { module, sent } = moduleWith({ to: "" });
    const { out, res } = response();
    await module.handle(post("hello"), res);
    expect(out.status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  it("says whether a challenge is required, so the bubble can render one first", async () => {
    const plain = moduleWith();
    const first = response();
    await plain.module.handle(request("GET", null), first.res);
    expect(JSON.parse(first.out.body)).toMatchObject({ ok: true, captcha: false });

    const guarded = moduleWith({ turnstileSecret: "0xsecret" });
    const second = response();
    await guarded.module.handle(request("GET", null), second.res);
    expect(JSON.parse(second.out.body)).toMatchObject({ ok: true, captcha: true });
  });

  it("refuses a message with no challenge token once the secret is set", async () => {
    const { module, sent, asked } = moduleWith({ turnstileSecret: "0xsecret" });
    const { out, res } = response();
    await module.handle(post("hello"), res);
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body)).toMatchObject({ error: "captcha-failed" });
    expect(sent).toHaveLength(0);
    // No token means no round trip: the refusal is local and cannot be bypassed
    // by whichever verifier a deployment injected.
    expect(asked).toHaveLength(0);
  });

  it("refuses a message whose challenge did not pass", async () => {
    const { module, sent } = moduleWith({ turnstileSecret: "0xsecret", captcha: false });
    const { out, res } = response();
    await module.handle(post("hello", {}, { captchaToken: "token" }), res);
    expect(out.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("sends once the challenge passes, and hands the token to the verifier", async () => {
    const { module, sent, asked } = moduleWith({ turnstileSecret: "0xsecret" });
    const { out, res } = response();
    await module.handle(post("hello", {}, { captchaToken: "the-token" }), res);
    expect(out.status).toBe(200);
    expect(asked).toEqual(["the-token"]);
    expect(sent).toHaveLength(1);
  });

  it("needs no token at all when no secret is set, so a self-host is unchanged", async () => {
    const { module, sent } = moduleWith();
    const { out, res } = response();
    await module.handle(post("hello"), res);
    expect(out.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});
