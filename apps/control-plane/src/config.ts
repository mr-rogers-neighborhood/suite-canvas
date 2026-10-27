import { readFileSync } from "node:fs";
import { isLogLevel, type LogLevel } from "./logging.js";

/**
 * One place that reads every variable this process itself needs, checks its
 * type and returns either a usable configuration or the reasons it is not one.
 *
 * It is called first in `server.ts`, before a socket is bound and before a
 * route module is asked to open a pool: a bad value is a startup error naming
 * the variable, never a listener that is up but cannot account for anyone.
 *
 * Everything a mounted module reads stays in the environment — those variables
 * belong to the module's own package. The one exception is `SUITE_AUTH_*`,
 * collected here so an operator can see which account switches reached the
 * process without any of their values being printed.
 */

export type ConfigEnv = Readonly<Record<string, string | undefined>>;

/** One reason the process will not start, always naming the variable at fault. */
export interface ConfigProblem {
  /** The variable as the operator typed it, e.g. `SUITE_CONTROL_PLANE_DATABASE_URL`. */
  variable: string;
  /** One sentence, safe to print: no value is echoed back. */
  message: string;
}

export const DEFAULT_PORT = 1236;
export const PORT_VARIABLE = "PORT";
export const DATABASE_URL_VARIABLE = "SUITE_CONTROL_PLANE_DATABASE_URL";
export const LOG_LEVEL_VARIABLE = "SUITE_LOG_LEVEL";
export const AUTH_VARIABLE_PREFIX = "SUITE_AUTH_";

/**
 * Module names that own Postgres-backed state. The host knows these two names
 * and nothing else about them: accounts, organizations, subscriptions and
 * licence records live in that one database (ADR-0069), so a deployment that
 * mounts either one cannot start without a connection string.
 */
export const DATABASE_MODULES: readonly string[] = ["auth", "billing", "admin"];

export interface ControlPlaneConfig {
  /** TCP port the listener binds; `PORT`, default 1236. */
  port: number;
  /** Connection string, or `null` when no mounted module needs Postgres. */
  databaseUrl: string | null;
  /** Every non-empty `SUITE_AUTH_*` value, passed through to the auth module. */
  auth: Readonly<Record<string, string>>;
  logLevel: LogLevel;
  /** Reported by `/health`, the startup line and every log line's process. */
  buildId: string;
}

export interface ConfigResult {
  ok: boolean;
  problems: ConfigProblem[];
  /** Best-effort values, so a caller can still log or test what it managed to read. */
  config: ControlPlaneConfig;
}

let cachedPackageVersion: string | null = null;

/** The version in this package's `package.json`, or `0.0.0` when it cannot be read. */
export function packageVersion(): string {
  if (cachedPackageVersion !== null) return cachedPackageVersion;
  let version = "0.0.0";
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      version = parsed.version.trim();
    }
  } catch {
    // A runtime image without package.json still starts; the stamp is just unknown.
  }
  cachedPackageVersion = version;
  return version;
}

/** `SUITE_VERSION` wins, so an image can carry its tag without package.json. */
export function buildIdOf(env: ConfigEnv): string {
  const configured = env.SUITE_VERSION?.trim();
  return configured && configured.length > 0 ? configured : packageVersion();
}

function text(env: ConfigEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function portOf(env: ConfigEnv): { value: number; problem: ConfigProblem | null } {
  const raw = env[PORT_VARIABLE];
  if (raw === undefined) return { value: DEFAULT_PORT, problem: null };
  const value = raw.trim();
  if (!/^\d+$/u.test(value)) {
    return {
      value: DEFAULT_PORT,
      problem: {
        variable: PORT_VARIABLE,
        message: `${PORT_VARIABLE} must be a whole port number, got "${value}".`,
      },
    };
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return {
      value: DEFAULT_PORT,
      problem: {
        variable: PORT_VARIABLE,
        message: `${PORT_VARIABLE} must be between 1 and 65535, got "${value}".`,
      },
    };
  }
  return { value: port, problem: null };
}

function databaseUrlOf(
  env: ConfigEnv,
  moduleNames: readonly string[],
): { value: string | null; problem: ConfigProblem | null } {
  const configured = text(env, DATABASE_URL_VARIABLE);
  if (configured === null) {
    const needy = DATABASE_MODULES.filter((name) => moduleNames.includes(name));
    if (needy.length === 0) return { value: null, problem: null };
    return {
      value: null,
      problem: {
        variable: DATABASE_URL_VARIABLE,
        message: `${DATABASE_URL_VARIABLE} is not set; the ${listOf(needy)} modules store accounts and licences in Postgres.`,
      },
    };
  }
  if (!/^postgres(?:ql)?:\/\//iu.test(configured)) {
    return {
      value: null,
      problem: {
        variable: DATABASE_URL_VARIABLE,
        message: `${DATABASE_URL_VARIABLE} must be a postgres:// or postgresql:// connection string.`,
      },
    };
  }
  return { value: configured, problem: null };
}

/** `a`, `a and b`, `a, b and c` — a list an operator reads rather than parses. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function logLevelOf(env: ConfigEnv): { value: LogLevel; problem: ConfigProblem | null } {
  const raw = env[LOG_LEVEL_VARIABLE];
  if (raw === undefined) return { value: "info", problem: null };
  const value = raw.trim().toLowerCase();
  if (!isLogLevel(value)) {
    return {
      value: "info",
      problem: {
        variable: LOG_LEVEL_VARIABLE,
        message: `${LOG_LEVEL_VARIABLE} must be one of debug, info, warn or error.`,
      },
    };
  }
  return { value, problem: null };
}

function authPassthrough(env: ConfigEnv): Readonly<Record<string, string>> {
  const collected: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    if (!key.startsWith(AUTH_VARIABLE_PREFIX)) continue;
    const value = text(env, key);
    if (value !== null) collected[key] = value;
  }
  return collected;
}

/**
 * The one pairing that would otherwise boot into a state nobody can leave.
 *
 * `SUITE_ADMISSION_REQUIRED` holds every new account, and only the operator route
 * releases one. With no token for that route the queue is a one-way door, so it is
 * reported at startup rather than discovered by the first person who signs up.
 */
function admissionProblemOf(env: ConfigEnv): ConfigProblem | null {
  const required = (env.SUITE_ADMISSION_REQUIRED ?? "").trim().toLowerCase();
  const queueOn = required === "1" || required === "true";
  const token = (env.SUITE_ADMIN_TOKEN ?? "").trim();
  if (!queueOn || token.length >= 16) return null;
  return {
    variable: "SUITE_ADMIN_TOKEN",
    message:
      "SUITE_ADMISSION_REQUIRED is on and SUITE_ADMIN_TOKEN is missing or too short, so nobody could be admitted",
  };
}

/**
 * `moduleNames` is what `loadModules` found, so "the database is required"
 * follows from what is actually mounted rather than from configuration alone:
 * today's empty module set boots with no Postgres at all.
 */
export function validateConfig(env: ConfigEnv, moduleNames: readonly string[] = []): ConfigResult {
  const port = portOf(env);
  const database = databaseUrlOf(env, moduleNames);
  const level = logLevelOf(env);
  const admission = admissionProblemOf(env);
  const problems = [port.problem, database.problem, level.problem, admission].filter(
    (problem): problem is ConfigProblem => problem !== null,
  );
  return {
    ok: problems.length === 0,
    problems,
    config: {
      port: port.value,
      databaseUrl: database.value,
      auth: authPassthrough(env),
      logLevel: level.value,
      buildId: buildIdOf(env),
    },
  };
}
