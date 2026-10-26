import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger, redactUrl } from "../logging.js";
import { clientAddress, createRateLimiter } from "./rateLimit.js";

/**
 * The CSP violation collector. A blocking policy protects a reader, but the
 * violations it blocks are the only evidence of what the policy costs, so every
 * site's `Content-Security-Policy` names this path in `report-uri` and
 * `report-to` (`deploy/Caddyfile`). The policy stays enforcing; nothing here
 * downgrades a site to report-only.
 *
 * Three shapes arrive, and all three are accepted because the reporting API is
 * not one format:
 *
 * - `application/csp-report` — the classic `{"csp-report": {…}}` body.
 * - `application/reports+json` — a batch of `{type: "csp-violation", body}`.
 * - `text/plain` — some embedders post a serialised object; it is parsed when it
 *   happens to be JSON and ignored when it is not.
 *
 * What is never done: the body is not stored, not echoed, not re-served, and not
 * logged whole. A report names the document that triggered it, and that document
 * URL can carry a share token, so both `document-uri` and `source-file` go
 * through the same redaction the request log uses. One line per report, capped by
 * a per-address rate limit; a browser that reports in a loop cannot fill a disk.
 */

/** Caddy proxies `/api/report/csp` here; nothing else is ours. */
export const CSP_REPORT_PATH = "/api/report/csp";

/** Largest report accepted. A CSP report is a few hundred bytes; this is generous. */
export const MAX_REPORT_BYTES = 16 * 1024;

/** Reports per address per minute. A page with a broken asset can be chatty. */
const REPORT_PER_MINUTE = 120;

export const reportLimiter = createRateLimiter(REPORT_PER_MINUTE, 60_000);

const logger = createLogger().child({ component: "csp-report" });

/** The fields worth a log line. `blocked-uri` and a directive name are not secrets. */
export interface CspViolation {
  documentUri: string | null;
  referrer: string | null;
  blockedUri: string | null;
  violatedDirective: string | null;
  effectiveDirective: string | null;
  disposition: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  /** `csp-report` or `reports+json`: which format the browser used. */
  shape: string;
}

/** A short, redacted string or null. Long values are truncated, never trusted. */
function field(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return redactUrl(trimmed).slice(0, max);
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One report from either format. Unknown shapes yield null, and a null report is
 * answered `204` like any other: the collector's job is to be quiet.
 */
export function parseReport(body: unknown, contentType: string): CspViolation | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  // Classic: {"csp-report": {"document-uri": …}}
  const classic = record["csp-report"];
  if (typeof classic === "object" && classic !== null) {
    const report = classic as Record<string, unknown>;
    return {
      documentUri: field(report["document-uri"]),
      referrer: field(report.referrer),
      blockedUri: field(report["blocked-uri"]),
      violatedDirective: field(report["violated-directive"]),
      effectiveDirective: field(report["effective-directive"]),
      disposition: field(report.disposition, 20),
      sourceFile: field(report["source-file"]),
      lineNumber: numberField(report["line-number"]),
      columnNumber: numberField(report["column-number"]),
      shape: "csp-report",
    };
  }

  // Reporting API: an array of {type, body}, or one of them.
  const entries = Array.isArray(body) ? body : [body];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const envelope = entry as Record<string, unknown>;
    const inner = envelope.body;
    if (typeof inner !== "object" || inner === null) continue;
    const report = inner as Record<string, unknown>;
    const type = typeof envelope.type === "string" ? envelope.type : contentType;
    if (type !== "csp-violation" && type !== "deprecation" && type !== "intervention") continue;
    return {
      documentUri: field(report.documentURL ?? report["document-uri"]),
      referrer: field(report.referrer),
      blockedUri: field(report.blockedURL ?? report["blocked-uri"]),
      violatedDirective: field(report.effectiveDirective ?? report["violated-directive"]),
      effectiveDirective: field(report.effectiveDirective),
      disposition: field(report.disposition, 20),
      sourceFile: field(report.sourceFile ?? report["source-file"]),
      lineNumber: numberField(report.lineNumber ?? report["line-number"]),
      columnNumber: numberField(report.columnNumber ?? report["column-number"]),
      shape: type,
    };
  }
  return null;
}

/** Reads a bounded body. The connection is destroyed past the cap. */
async function readBounded(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > MAX_REPORT_BYTES) return null;
    chunks.push(buffer);
  }
  return size === 0 ? "" : Buffer.concat(chunks).toString("utf8");
}

/** `204` always: a reporting endpoint that answers an error teaches nobody anything. */
function done(response: ServerResponse): void {
  response.writeHead(204, { "cache-control": "no-store" });
  response.end();
}

/**
 * Handles `POST /api/report/csp`. Returns false when the path is not this one, so
 * the caller can ask the next handler.
 */
export async function handleReportRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const pathname = (request.url ?? "").split("?")[0] ?? "";
  if (pathname !== CSP_REPORT_PATH) return false;

  if ((request.method ?? "GET").toUpperCase() !== "POST") {
    response.writeHead(405, { allow: "POST", "cache-control": "no-store" });
    response.end();
    return true;
  }
  // Over budget: drop the report without reading it, and say so quietly. A
  // `429` here would be retried by some clients; `204` ends the conversation.
  if (!reportLimiter.take(clientAddress(request)).ok) {
    done(response);
    return true;
  }

  const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
  const raw = await readBounded(request);
  if (raw === null || raw.trim().length === 0) {
    done(response);
    return true;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const violation = parseReport(parsed, contentType);
  if (violation !== null) {
    logger.warn("csp.violation", { ...violation, contentType: contentType.slice(0, 64) });
  }
  done(response);
  return true;
}
