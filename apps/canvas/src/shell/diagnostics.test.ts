import { afterEach, describe, expect, it } from "vitest";
import {
  buildDiagnosticBundle,
  buildDiagnostics,
  describeError,
  diagnosticsFileName,
  installRequestIdRecorder,
  redactConfig,
  safeRoute,
  scrubText,
  useDiagnosticsStore,
} from "./diagnostics";

/**
 * The bundle is the one artefact this project asks a stranger to paste into a
 * ticket, so the tests are about what it must never contain as much as about
 * what it must.
 */

const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmciOiJvcmctMSJ9.c2lnbmF0dXJlLXZhbHVl";
const SHARE_TOKEN = "c2hhcmVUb2tlbjAxMjM0NTY3ODlhYmNkZWZnaGlqa2xtbm9wcXI";

afterEach(() => {
  useDiagnosticsStore.getState().clear();
});

describe("safeRoute", () => {
  it("drops the fragment, which is where an owner key used to live", () => {
    expect(safeRoute("https://app.suite.run/canvas?workspace=ws-1#owner=abc")).toBe(
      "/canvas?workspace=ws-1",
    );
  });

  it("redacts a share token and keeps the route readable", () => {
    expect(safeRoute(`https://app.suite.run/canvas?share=${SHARE_TOKEN}`)).toBe(
      "/canvas?share=redacted",
    );
  });

  it("redacts a sign-in code and state", () => {
    expect(safeRoute("https://app.suite.run/?code=abc123&state=xyz")).toBe(
      "/?code=redacted&state=redacted",
    );
  });
});

describe("scrubText", () => {
  it("removes a session JWT", () => {
    expect(scrubText(`authorization was Bearer ${JWT}`)).not.toContain(JWT);
  });

  it("removes a bare token-shaped run", () => {
    expect(scrubText(`token ${SHARE_TOKEN} in a message`)).not.toContain(SHARE_TOKEN);
  });

  it("redacts a secret query value even inside a sentence", () => {
    expect(scrubText(`GET /api/workspaces?token=${SHARE_TOKEN} failed`)).toBe(
      "GET /api/workspaces?token=redacted failed",
    );
  });

  it("leaves ordinary prose alone", () => {
    expect(scrubText("boards=3 cards=12 sections=1")).toBe("boards=3 cards=12 sections=1");
  });
});

describe("redactConfig", () => {
  it("keeps an origin and nothing else", () => {
    expect(redactConfig({ relay: "https://relay.suite.run/api?token=abc" }).relay).toBe(
      "https://relay.suite.run",
    );
  });

  it("refuses to echo a value that is not a URL", () => {
    expect(redactConfig({ relay: "not a url" }).relay).toBeNull();
  });

  it("scrubs a label that carries a token", () => {
    const config = redactConfig({ surface: `share=${SHARE_TOKEN}` });
    expect(config.surface).toBe("share=redacted");
  });
});

describe("describeError", () => {
  it("scrubs a message and a stack before they are stored", () => {
    const error = new Error(`fetch failed for /api/shares?share=${SHARE_TOKEN}`);
    error.stack = `Error: boom\n    at open (https://app.suite.run/x?share=${SHARE_TOKEN})`;
    const described = describeError(error, `https://app.suite.run/canvas?share=${SHARE_TOKEN}`);
    expect(described.message).not.toContain(SHARE_TOKEN);
    expect(described.stack).not.toContain(SHARE_TOKEN);
    expect(described.route).toBe("/canvas?share=redacted");
  });
});

describe("buildDiagnosticBundle", () => {
  const base = {
    route: `https://app.suite.run/canvas?workspace=ws-1&share=${SHARE_TOKEN}`,
    storage: {
      persist: "persisted" as const,
      estimate: { usage: 1024, quota: 2048 },
      quota: null,
    },
    connection: "connected (synced)",
    build: { version: "0.2.0-beta.1", mode: "production", production: true },
    now: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("carries the build, the route, storage and connection state", () => {
    const bundle = buildDiagnosticBundle(base);
    expect(bundle.format).toBe("suite.diagnostics/1");
    expect(bundle.build.version).toBe("0.2.0-beta.1");
    expect(bundle.route).toBe("/canvas?workspace=ws-1&share=redacted");
    expect(bundle.storage.usageLabel).toBe("1 KB of 2 KB");
    expect(bundle.connection).toBe("connected (synced)");
    expect(bundle.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("includes the errors and request ids it was given, and nothing else", () => {
    const bundle = buildDiagnosticBundle({
      ...base,
      errors: [
        {
          name: "Error",
          message: `socket closed for ?share=${SHARE_TOKEN}`,
          stack: "Error: closed",
          at: Date.parse("2026-01-01T00:00:00.000Z"),
          route: "/canvas?share=abc",
        },
      ],
      requestIds: ["req-1"],
    });
    expect(bundle.requestIds).toEqual(["req-1"]);
    expect(bundle.errors).toHaveLength(1);
    expect(bundle.errors[0]?.message).not.toContain(SHARE_TOKEN);
  });

  it("never carries a credential that was passed in through the route or a label", () => {
    const text = JSON.stringify(
      buildDiagnosticBundle({
        ...base,
        config: { relay: "https://relay.suite.run?key=abc", surface: `t=${JWT}` },
      }),
    );
    expect(text).not.toContain(JWT);
    expect(text).not.toContain(SHARE_TOKEN);
  });

  it("renders a text block whose last-error section is explicit when there is none", () => {
    const text = buildDiagnostics({ ...base, errors: [], requestIds: [] });
    expect(text).toContain("last error: none recorded");
    expect(text).toContain("request ids: none seen");
  });

  it("names the file after the build and the capture time", () => {
    const bundle = buildDiagnosticBundle(base);
    expect(diagnosticsFileName(bundle)).toBe(
      "suite-diagnostics-0.2.0-beta.1-2026-01-01T00-00-00-000Z.json",
    );
  });
});

describe("useDiagnosticsStore", () => {
  it("bounds the recorded errors and puts the newest first", () => {
    const store = useDiagnosticsStore.getState();
    for (let index = 0; index < 15; index += 1) {
      store.record({
        name: "Error",
        message: `failure ${index}`,
        stack: null,
        at: index,
        route: "/canvas",
      });
    }
    const state = useDiagnosticsStore.getState();
    expect(state.errors).toHaveLength(10);
    expect(state.errors[0]?.message).toBe("failure 14");
    expect(state.lastError?.message).toBe("failure 14");
  });

  it("keeps request ids unique and bounded", () => {
    const store = useDiagnosticsStore.getState();
    store.noteRequestId("a");
    store.noteRequestId("b");
    store.noteRequestId("a");
    expect(useDiagnosticsStore.getState().requestIds).toEqual(["a", "b"]);
  });
});

describe("installRequestIdRecorder", () => {
  it("records the header the relay sends and restores fetch on cleanup", async () => {
    const original = globalThis.fetch;
    const fake = async () =>
      new Response("{}", { status: 200, headers: { "x-request-id": "req-42" } });
    Object.defineProperty(globalThis, "fetch", { value: fake, configurable: true });
    try {
      const stop = installRequestIdRecorder(globalThis as unknown as Window);
      await globalThis.fetch("/api/status");
      expect(useDiagnosticsStore.getState().requestIds).toEqual(["req-42"]);
      stop();
      expect(globalThis.fetch).toBe(fake);
    } finally {
      Object.defineProperty(globalThis, "fetch", { value: original, configurable: true });
    }
  });
});
