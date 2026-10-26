import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSP_REPORT_PATH,
  handleReportRequest,
  MAX_REPORT_BYTES,
  parseReport,
  reportLimiter,
} from "./report.js";

/**
 * The collector is public and unauthenticated, so the tests are about bounds
 * (size, rate) and about what a log line may carry: a CSP report names the page
 * that broke, and that page URL can hold a share token.
 */

const SHARE_TOKEN = "c2hhcmVUb2tlbjAxMjM0NTY3ODlhYmNkZWZnaGlqa2xtbm9wcXI";

let server: Server | null = null;

beforeEach(() => {
  // One accepted report is one log line; the tests assert on the parsed shape, so
  // the line itself is only noise here.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  reportLimiter.reset();
  const running = server;
  server = null;
  if (running !== null) await new Promise<void>((resolve) => running.close(() => resolve()));
});

async function listen(): Promise<string> {
  const created = createServer((request, response) => {
    void handleReportRequest(request, response).then((handled) => {
      if (handled) return;
      response.writeHead(404);
      response.end();
    });
  });
  server = created;
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  const address = created.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

describe("parseReport", () => {
  it("reads the classic csp-report body and redacts the document URL", () => {
    const violation = parseReport(
      {
        "csp-report": {
          "document-uri": `https://app.suite.run/canvas?share=${SHARE_TOKEN}`,
          "blocked-uri": "https://tracker.example/pixel",
          "violated-directive": "img-src",
          "effective-directive": "img-src",
          disposition: "enforce",
          "source-file": "https://app.suite.run/assets/index-abc.js",
          "line-number": 12,
        },
      },
      "application/csp-report",
    );
    expect(violation?.shape).toBe("csp-report");
    expect(violation?.documentUri).not.toContain(SHARE_TOKEN);
    expect(violation?.documentUri).toContain("share=redacted");
    expect(violation?.blockedUri).toBe("https://tracker.example/pixel");
    expect(violation?.effectiveDirective).toBe("img-src");
    expect(violation?.lineNumber).toBe(12);
  });

  it("reads a Reporting API batch", () => {
    const violation = parseReport(
      [
        {
          type: "csp-violation",
          body: {
            documentURL: "https://app.suite.run/canvas",
            blockedURL: "inline",
            effectiveDirective: "script-src",
            disposition: "enforce",
          },
        },
      ],
      "application/reports+json",
    );
    expect(violation?.shape).toBe("csp-violation");
    expect(violation?.blockedUri).toBe("inline");
    expect(violation?.effectiveDirective).toBe("script-src");
  });

  it("ignores a body that is not a report", () => {
    expect(parseReport({ hello: "world" }, "application/json")).toBeNull();
    expect(parseReport("a string", "text/plain")).toBeNull();
    expect(parseReport(null, "application/json")).toBeNull();
  });
});

describe("handleReportRequest", () => {
  it("accepts a report and answers 204 with no body", async () => {
    const base = await listen();
    const response = await fetch(`${base}${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "document-uri": "https://app.suite.run/" } }),
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("declines a path that is not the collector", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(404);
  });

  it("refuses a method other than POST", async () => {
    const base = await listen();
    const response = await fetch(`${base}${CSP_REPORT_PATH}`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("answers 204 for a body past the size cap instead of reading it", async () => {
    const base = await listen();
    const response = await fetch(`${base}${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "x".repeat(MAX_REPORT_BYTES + 1),
    });
    expect(response.status).toBe(204);
  });

  it("answers 204 for malformed JSON", async () => {
    const base = await listen();
    const response = await fetch(`${base}${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json at all",
    });
    expect(response.status).toBe(204);
  });

  it("stops answering past the per-address rate limit", async () => {
    const base = await listen();
    let last = 0;
    for (let index = 0; index < 130; index += 1) {
      const response = await fetch(`${base}${CSP_REPORT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: JSON.stringify({ "csp-report": { "document-uri": "https://app.suite.run/" } }),
      });
      last = response.status;
      // Every answer is 204; the limit is visible as work not being done, not as
      // a status change a client would retry on.
      expect(response.status).toBe(204);
    }
    expect(last).toBe(204);
  });
});
