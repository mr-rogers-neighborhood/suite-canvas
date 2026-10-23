/**
 * One structured line per event, in the shape the relay already uses
 * (`{ts, level, msg, component, ...fields}`), so billing and relay logs read
 * the same way in CloudWatch.
 *
 * Callers must never put a licence token in `fields`: the token is the
 * credential, and a log line is the easiest place to leak it.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type Logger = (level: LogLevel, message: string, fields?: LogFields) => void;

export const jsonLogger: Logger = (level, message, fields) => {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    component: "billing",
    ...fields,
  });
  process.stdout.write(`${line}\n`);
};
