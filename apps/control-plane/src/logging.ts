import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

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

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (logLevels as readonly string[]).includes(value);
}

function levelFromEnv(): LogLevel {
  const raw = process.env.SUITE_LOG_LEVEL?.trim().toLowerCase();
  return isLogLevel(raw) ? raw : "info";
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

export const REQUEST_ID_HEADER = "x-request-id";

/** An inbound id is only echoed when it could not forge a log line. */
const requestIdPattern = /^[A-Za-z0-9._:-]{1,64}$/u;

/** The inbound `x-request-id` when it looks safe, otherwise a fresh UUID. */
export function requestIdOf(request: IncomingMessage): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return requestIdPattern.test(trimmed) ? trimmed : randomUUID();
}
