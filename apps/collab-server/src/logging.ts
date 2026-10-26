import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

/** Fields attached to one line. Values are serialized with `JSON.stringify`. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  /** A logger that adds `fields` to every line it writes. */
  child: (fields: LogFields) => Logger;
}

export interface LoggerOptions {
  /** Minimum level to write; defaults to `SUITE_LOG_LEVEL` or `info`. */
  level?: LogLevel;
  /** Destination for one line already ending in `\n`; defaults to stdout. */
  write?: (line: string) => void;
  /** Clock, for tests. */
  now?: () => number;
}

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const reserved = new Set(["ts", "level", "msg"]);

function levelFromEnv(): LogLevel {
  const raw = process.env.SUITE_LOG_LEVEL?.trim().toLowerCase();
  return logLevels.find((level) => level === raw) ?? "info";
}

/**
 * One JSON object per line. A field that cannot be serialized is replaced
 * instead of dropping the line, so logging never throws into a request.
 */
function serialize(record: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(record, (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[circular]";
        seen.add(value);
      }
      return value;
    });
  } catch {
    return JSON.stringify({
      ts: record.ts,
      level: record.level,
      msg: record.msg,
      error: "unserializable fields",
    });
  }
}

function buildLogger(options: LoggerOptions, base: LogFields): Logger {
  const level = options.level ?? levelFromEnv();
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const now = options.now ?? Date.now;

  const emit = (entryLevel: LogLevel, msg: string, fields?: LogFields): void => {
    if (priorities[entryLevel] < priorities[level]) return;
    const record: Record<string, unknown> = {
      ts: new Date(now()).toISOString(),
      level: entryLevel,
      msg,
    };
    for (const [key, value] of Object.entries({ ...base, ...fields })) {
      if (reserved.has(key) || value === undefined) continue;
      record[key] = value;
    }
    write(`${serialize(record)}\n`);
  };

  return {
    level,
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => buildLogger(options, { ...base, ...fields }),
  };
}

/** A dependency-free structured logger writing one JSON line per call. */
export function createLogger(options: LoggerOptions = {}): Logger {
  return buildLogger(options, {});
}

/** Query parameters whose value is a capability or a credential. */
const sensitiveQueryNames = new Set(["share", "token", "key", "owner"]);
const shareApiPrefix = "/api/shares/";

/** Replacement written where a capability was. */
export const REDACTED = "redacted";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, " "));
  } catch {
    return value;
  }
}

/**
 * Hides the token of `/api/shares/<token>` (and any sub-path such as
 * `/publish`) while leaving the collection path and every other path intact.
 */
export function redactPath(path: string): string {
  if (!path.startsWith(shareApiPrefix)) return path;
  const rest = path.slice(shareApiPrefix.length);
  if (rest.length === 0) return path;
  const slash = rest.indexOf("/");
  const token = slash === -1 ? rest : rest.slice(0, slash);
  if (token.length === 0) return path;
  return `${shareApiPrefix}${REDACTED}${slash === -1 ? "" : rest.slice(slash)}`;
}

/**
 * Redacts capability values in a request target: the `share`, `token`, `key`
 * and `owner` query parameters and the share token path segment. Everything
 * else (other parameters, their order and encoding) is preserved so the line
 * still identifies the request.
 */
export function redactUrl(target: string): string {
  let origin = "";
  let rest = target;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(target)) {
    const url = new URL(target);
    origin = url.origin;
    rest = target.slice(url.origin.length) || "/";
  }

  const hashIndex = rest.indexOf("#");
  const hash = hashIndex === -1 ? "" : rest.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  const questionIndex = withoutHash.indexOf("?");
  const path = questionIndex === -1 ? withoutHash : withoutHash.slice(0, questionIndex);
  const query = questionIndex === -1 ? "" : withoutHash.slice(questionIndex + 1);
  const redactedPath = redactPath(path);
  if (query.length === 0) return `${origin}${redactedPath}${hash}`;

  const redactedQuery = query
    .split("&")
    .map((pair) => {
      if (pair.length === 0) return pair;
      const equals = pair.indexOf("=");
      const rawName = equals === -1 ? pair : pair.slice(0, equals);
      if (!sensitiveQueryNames.has(safeDecode(rawName).toLowerCase())) return pair;
      return `${rawName}=${REDACTED}`;
    })
    .join("&");

  return `${origin}${redactedPath}?${redactedQuery}${hash}`;
}

const requestIdPattern = /^[A-Za-z0-9._:-]{1,64}$/u;

/** An inbound `x-request-id` when it looks safe, otherwise a fresh UUID. */
export function requestIdOf(request: IncomingMessage): string {
  const header = request.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return requestIdPattern.test(trimmed) ? trimmed : randomUUID();
}

export interface RequestLoggerOptions {
  logger?: Logger;
  now?: () => number;
}

/** What one request line will hold, once it is written. */
export interface RequestLogContext {
  requestId: string;
  method: string;
  /** Request target with every capability redacted. */
  path: string;
  /** Writes the line once; later calls are ignored. */
  finish: (status?: number) => void;
}

/**
 * Records `{ requestId, method, path, status, durationMs }` when the response
 * finishes, or when `finish` is called for a request that never answered.
 * Bodies, cookies and headers are never part of a line.
 */
export function createRequestLogger(
  request: IncomingMessage,
  response?: ServerResponse,
  options: RequestLoggerOptions = {},
): RequestLogContext {
  const logger = options.logger ?? createLogger();
  const now = options.now ?? Date.now;
  const startedAt = now();
  const requestId = requestIdOf(request);
  const method = (request.method ?? "GET").toUpperCase();
  const path = redactUrl(request.url ?? "/");
  // The id travels back in the response so a client can name it in a support
  // ticket; the log line and the header are the same value by construction.
  response?.setHeader("x-request-id", requestId);
  let written = false;

  const finish = (status?: number): void => {
    if (written) return;
    written = true;
    logger.info("http.request", {
      requestId,
      method,
      path,
      status: status ?? response?.statusCode ?? 0,
      durationMs: Math.max(0, now() - startedAt),
    });
  };

  response?.once("finish", () => finish());

  return { requestId, method, path, finish };
}
