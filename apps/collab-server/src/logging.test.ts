import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  createRequestLogger,
  type LogFields,
  type Logger,
  REDACTED,
  redactPath,
  redactUrl,
  requestIdOf,
} from "./logging.js";

interface Captured {
  lines: string[];
  logger: Logger;
}

function capture(level: "debug" | "info" | "warn" | "error" = "debug"): Captured {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    write: (line) => lines.push(line),
    now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
  });
  return { lines, logger };
}

function parse(line: string): Record<string, unknown> {
  expect(line.endsWith("\n")).toBe(true);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("log lines", () => {
  it("writes one JSON object per line with ts, level, msg and fields", () => {
    const { lines, logger } = capture();
    logger.info("server ready", { port: 1234, ok: true });

    expect(lines).toHaveLength(1);
    const record = parse(lines[0] as string);
    expect(record).toEqual({
      ts: "2026-01-02T03:04:05.000Z",
      level: "info",
      msg: "server ready",
      port: 1234,
      ok: true,
    });
    expect(Object.keys(record).slice(0, 3)).toEqual(["ts", "level", "msg"]);
  });

  it("carries child fields and does not let a field overwrite the envelope", () => {
    const { lines, logger } = capture();
    logger.child({ component: "sqlite" }).warn("slow", { msg: "clobber", level: "debug" });

    const record = parse(lines[0] as string);
    expect(record.component).toBe("sqlite");
    expect(record.msg).toBe("slow");
    expect(record.level).toBe("warn");
  });

  it("skips lines below the configured level", () => {
    const { lines, logger } = capture("warn");
    logger.debug("noise");
    logger.info("noise");
    expect(lines).toHaveLength(0);
    logger.error("kept");
    expect(lines).toHaveLength(1);
  });

  it("survives circular and bigint fields", () => {
    const { lines, logger } = capture();
    const circular: LogFields = { count: 1n };
    circular.self = circular;
    logger.info("odd", circular);

    expect(() => parse(lines[0] as string)).not.toThrow();
    const record = parse(lines[0] as string);
    expect(record.count).toBe("1");
    expect(lines[0]).toContain("[circular]");
  });
});

describe("redaction", () => {
  it("redacts capability query parameters and leaves the rest intact", () => {
    const target =
      "/api/shares/tok_ABC-123/publish?share=tok_ABC-123&token=t&key=k&owner=o&workspace=ws-1&limit=5";

    expect(redactUrl(target)).toBe(
      `/api/shares/${REDACTED}/publish?share=${REDACTED}&token=${REDACTED}&key=${REDACTED}&owner=${REDACTED}&workspace=ws-1&limit=5`,
    );
  });

  it("redacts the share token path segment", () => {
    expect(redactPath("/api/shares/abc123")).toBe(`/api/shares/${REDACTED}`);
    expect(redactPath("/api/shares/abc123/status")).toBe(`/api/shares/${REDACTED}/status`);
    expect(redactPath("/api/shares")).toBe("/api/shares");
    expect(redactPath("/api/shares/")).toBe("/api/shares/");
    expect(redactPath("/api/admin/shares")).toBe("/api/admin/shares");
    expect(redactPath("/api/workspaces/ws-1")).toBe("/api/workspaces/ws-1");
  });

  it("redacts a bare capability parameter and keeps unrelated encoding", () => {
    expect(redactUrl("/api/shares?owner")).toBe(`/api/shares?owner=${REDACTED}`);
    expect(redactUrl("/api/shares?workspace=a%20b&q=x+y")).toBe(
      "/api/shares?workspace=a%20b&q=x+y",
    );
  });

  it("redacts an absolute URL and keeps its origin", () => {
    expect(redactUrl("https://canvas.example/api/shares/tok?share=tok&workspace=w")).toBe(
      `https://canvas.example/api/shares/${REDACTED}?share=${REDACTED}&workspace=w`,
    );
  });

  it("ignores a malformed percent escape instead of throwing", () => {
    expect(redactUrl("/api/shares?token=%E0%A4%A")).toBe(`/api/shares?token=${REDACTED}`);
    expect(redactUrl("/api/shares/%E0%A4%A")).toBe(`/api/shares/${REDACTED}`);
  });
});

describe("request logger", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  it("records method, redacted path, status and duration on finish", async () => {
    const { lines, logger } = capture();
    let tick = 0;
    const server = createServer((request, response) => {
      const context = createRequestLogger(request, response, { logger, now: () => (tick += 5) });
      expect(context.path).not.toContain("tok_ABC-123");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/shares/tok_ABC-123/publish?share=tok_ABC-123&workspace=ws-1`,
      { headers: { authorization: "Bearer secret", cookie: "session=secret" } },
    );
    expect(response.status).toBe(201);
    await response.text();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lines).toHaveLength(1);
    const record = parse(lines[0] as string);
    expect(record.msg).toBe("http.request");
    expect(record.method).toBe("GET");
    expect(record.path).toBe(`/api/shares/${REDACTED}/publish?share=${REDACTED}&workspace=ws-1`);
    expect(record.status).toBe(201);
    expect(record.durationMs).toBe(5);
    expect(typeof record.requestId).toBe("string");
    expect((record.requestId as string).length).toBeGreaterThan(0);

    const line = lines[0] as string;
    expect(line).not.toContain("tok_ABC-123");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("authorization");
    expect(line).not.toContain("cookie");
  });

  it("writes once, and lets a caller record a request that never answered", () => {
    const { lines, logger } = capture();
    const request = {
      method: "post",
      url: "/api/workspaces/ws-1/claim?key=owner-key",
      headers: { "x-request-id": "req-123" },
    } as unknown as Parameters<typeof createRequestLogger>[0];

    const context = createRequestLogger(request, undefined, { logger });
    expect(context.requestId).toBe("req-123");
    expect(context.method).toBe("POST");
    expect(context.path).toBe(`/api/workspaces/ws-1/claim?key=${REDACTED}`);

    context.finish(499);
    context.finish();
    expect(lines).toHaveLength(1);
    expect(parse(lines[0] as string).status).toBe(499);
  });

  it("replaces an unsafe request id header", () => {
    const request = {
      headers: { "x-request-id": "bad id with spaces" },
    } as unknown as Parameters<typeof requestIdOf>[0];
    expect(requestIdOf(request)).not.toBe("bad id with spaces");

    const safe = { headers: { "x-request-id": "req-123" } } as unknown as Parameters<
      typeof requestIdOf
    >[0];
    expect(requestIdOf(safe)).toBe("req-123");
  });
});
