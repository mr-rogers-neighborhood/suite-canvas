import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { parseLicencePublicKey } from "@suite/licence";
import { type LogLevel, logLevels } from "../logging.js";
import { LIMIT_ENV, LIMIT_KEYS, type Limits, limitsProblem, resolveLimits } from "./limits.js";

/**
 * One place that reads every `SUITE_*` variable (plus the two ports), checks its
 * type and returns either a usable configuration or the reasons it is not one.
 *
 * It is called first in `server.ts`, before a socket is bound or a database is
 * opened: a bad value is a startup error with a named variable, not a quota that
 * silently never fires or a token that is quietly shorter than it looks.
 */

export type ConfigEnv = Readonly<Record<string, string | undefined>>;

/** One reason the process will not start, always naming the variable at fault. */
export interface ConfigProblem {
  /** The variable as the operator typed it, e.g. `HEALTH_PORT`. */
  variable: string;
  /** One sentence, safe to print: no value is echoed back. */
  message: string;
}

export type DatabaseName =
  | "documents"
  | "shares"
  | "workspaces"
  | "settings"
  | "licences"
  | "attachments";

export interface ServerConfig {
  /** Version stamp: `SUITE_VERSION` when the image bakes one, else `package.json`. */
  version: string;
  hosted: boolean;
  ports: { ws: number; health: number };
  /** The three database files, plus the optional stores (`null` keeps them in memory). */
  paths: {
    documents: string;
    shares: string;
    workspaces: string;
    settings: string | null;
    licences: string | null;
    attachments: string | null;
  };
  /** Configured credentials; `null` means the feature is off or generated. */
  tokens: {
    admin: string | null;
    /** Read-only operator token: `/metrics` and the inventories, never a mutation. */
    adminRead: string | null;
    projection: string | null;
    source: string | null;
  };
  licencePublicKey: string | null;
  /**
   * The control plane's origin (`SUITE_AUTH_URL`). Null means no session token
   * can be verified here, so no account reaches a room; the relay still serves
   * anonymous and share-link use.
   */
  authUrl: string | null;
  allowedOrigins: readonly string[];
  trustProxy: boolean;
  logLevel: LogLevel;
  rateLimits: {
    claim: number;
    rotate: number;
    shareResolve: number;
    shareCreate: number;
    publish: number;
    admin: number;
  };
  /** Effective limits after defaults and `SUITE_*` overrides. */
  limits: Limits;
}

export interface ConfigResult {
  ok: boolean;
  problems: ConfigProblem[];
  /** Best-effort values, so a caller can still log or test what it managed to read. */
  config: ServerConfig;
}

export const DEFAULT_PORTS = { ws: 1234, health: 1235 } as const;

export const DEFAULT_DATABASE_PATHS = {
  documents: "suite.documents.sqlite",
  shares: "suite.shares.sqlite",
  workspaces: "suite.workspaces.sqlite",
} as const;

/** Every database file and the variable that names it. */
export const DATABASE_ENV = {
  documents: "SUITE_DB",
  shares: "SUITE_SHARES_DB",
  workspaces: "SUITE_WORKSPACES_DB",
  settings: "SUITE_SETTINGS_DB",
  licences: "SUITE_LICENCE_DB",
  attachments: "SUITE_ATTACHMENTS_DB",
} as const satisfies Record<DatabaseName, string>;

/** Fixed windows from `rateLimit.ts`; only their per-minute limits are read here. */
export const RATE_LIMIT_ENV = {
  claim: "SUITE_CLAIM_RATE_LIMIT",
  rotate: "SUITE_ROTATE_RATE_LIMIT",
  shareResolve: "SUITE_SHARE_RESOLVE_RATE_LIMIT",
  shareCreate: "SUITE_SHARE_CREATE_RATE_LIMIT",
  publish: "SUITE_PUBLISH_RATE_LIMIT",
  admin: "SUITE_ADMIN_RATE_LIMIT",
} as const;

const RATE_LIMIT_DEFAULTS = {
  claim: 600,
  rotate: 10,
  shareResolve: 300,
  shareCreate: 30,
  publish: 20,
  admin: 300,
} as const;

/** Shortest admin/worker credential accepted at boot. */
export const MIN_TOKEN_LENGTH = 16;

/** `:memory:` is SQLite's own name for a store that never touches disk. */
const MEMORY_PATH = ":memory:";

let cachedPackageVersion: string | null = null;

/** The version in this package's `package.json`, or `0.0.0` when it cannot be read. */
export function packageVersion(): string {
  if (cachedPackageVersion !== null) return cachedPackageVersion;
  let version = "0.0.0";
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
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

/**
 * The stamp reported by `/api/admin/status`, `/metrics` and the startup line.
 * `SUITE_VERSION` wins so an image can carry its tag even when package.json is
 * not in the deployment.
 */
export function serverVersion(env: ConfigEnv = process.env): string {
  const configured = env.SUITE_VERSION?.trim();
  return configured && configured.length > 0 ? configured : packageVersion();
}

function text(env: ConfigEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "";
}

/**
 * Parses a positive integer, reporting the variable name and the shape it
 * expected. Never echoes a secret; these are ports, rates and sizes.
 */
function positiveInteger(
  raw: string,
  variable: string,
  fallback: number,
  options: { max?: number; unit?: string } = {},
): { value: number; problem: ConfigProblem | null } {
  const expected = options.unit ? `a whole number of ${options.unit}` : "a whole number";
  if (!/^\d+$/u.test(raw)) {
    return {
      value: fallback,
      problem: { variable, message: `${variable} must be ${expected}, got "${raw}".` },
    };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return {
      value: fallback,
      problem: { variable, message: `${variable} must be at least 1, got "${raw}".` },
    };
  }
  if (options.max !== undefined && value > options.max) {
    return {
      value: fallback,
      problem: { variable, message: `${variable} must be at most ${options.max}, got "${raw}".` },
    };
  }
  return { value, problem: null };
}

function port(
  env: ConfigEnv,
  variable: string,
  fallback: number,
): { value: number; problem: ConfigProblem | null } {
  const raw = env[variable];
  if (raw === undefined) return { value: fallback, problem: null };
  if (raw.trim().length === 0) {
    return {
      value: fallback,
      problem: { variable, message: `${variable} is empty; unset it or give a port number.` },
    };
  }
  return positiveInteger(raw.trim(), variable, fallback, { max: 65_535 });
}

function databasePath(
  env: ConfigEnv,
  name: DatabaseName,
  fallback: string | null,
): { value: string | null; problems: ConfigProblem[] } {
  const variable = DATABASE_ENV[name];
  const raw = env[variable];
  if (raw === undefined) return { value: fallback, problems: [] };
  const value = raw.trim();
  if (value.length === 0) {
    return {
      value: fallback,
      problems: [{ variable, message: `${variable} is empty; unset it to use the default path.` }],
    };
  }
  if (value === MEMORY_PATH) return { value, problems: [] };
  try {
    if (!statSync(value).isFile()) {
      return {
        value,
        problems: [
          {
            variable,
            message: `${variable} must name a file SQLite can open; "${value}" is not a regular file.`,
          },
        ],
      };
    }
  } catch {
    // Not existing yet is the normal case: the store creates the file.
  }
  return { value, problems: [] };
}

/** The file a composed deployment suggests for a store, used only in a refusal. */
function durableExample(name: DatabaseName, root: string | null): string {
  return `${root ?? "/data"}/${name}.sqlite`;
}

/**
 * `SUITE_REQUIRE_DURABLE_STORES=1` is for a composed deployment, where a
 * `:memory:` store or a path relative to the container's working directory is
 * silently disposable. Each of the six stores must then be an absolute path to
 * a file directly in one directory: the volume root. That root is the directory
 * most stores already share, so a split names the minority, and a tie falls back
 * to the first store's directory. One problem per offending variable, never a
 * value that could be a secret.
 */
function durableStoreProblems(
  env: ConfigEnv,
  paths: Record<DatabaseName, string | null>,
): ConfigProblem[] {
  const names = Object.keys(DATABASE_ENV) as DatabaseName[];
  const directories = names
    .map((name) => paths[name])
    .filter((path): path is string => path !== null && path !== MEMORY_PATH)
    .map((path) => (isAbsolute(path) ? dirname(path) : null));
  const counts = new Map<string, number>();
  for (const directory of directories) {
    if (directory !== null) counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  let root: string | null = null;
  let best = 0;
  for (const directory of directories) {
    if (directory === null) continue;
    const count = counts.get(directory) ?? 0;
    if (count > best) {
      root = directory;
      best = count;
    }
  }

  const problems: ConfigProblem[] = [];
  for (const name of names) {
    const variable = DATABASE_ENV[name];
    const path = paths[name];
    // An empty value already has its own problem; one problem per variable.
    if (env[variable]?.trim().length === 0) continue;
    const fix = `Set ${variable} to ${durableExample(name, root)}.`;
    if (path === null) {
      problems.push({
        variable,
        message: `${variable} is not set; SUITE_REQUIRE_DURABLE_STORES=1 requires all six stores to name a file. ${fix}`,
      });
      continue;
    }
    if (path === MEMORY_PATH) {
      problems.push({
        variable,
        message: `${variable} is ":memory:", so the store is lost on restart; SUITE_REQUIRE_DURABLE_STORES=1 requires a file on the data volume. ${fix}`,
      });
      continue;
    }
    if (!isAbsolute(path)) {
      problems.push({
        variable,
        message: `${variable} is "${path}", a relative path resolved against the working directory; SUITE_REQUIRE_DURABLE_STORES=1 requires an absolute path on the data volume. ${fix}`,
      });
      continue;
    }
    const directory = dirname(path);
    if (root !== null && directory !== root) {
      problems.push({
        variable,
        message: `${variable} is in "${directory}" while the other stores are in "${root}"; SUITE_REQUIRE_DURABLE_STORES=1 requires all six files in one directory (the data volume). ${fix}`,
      });
    }
  }
  return problems;
}

function token(
  env: ConfigEnv,
  variable: string,
): { value: string | null; problem: ConfigProblem | null } {
  const raw = text(env, variable);
  if (raw === null) return { value: null, problem: null };
  if (raw.length === 0) {
    return { value: null, problem: null };
  }
  if (/[\s\p{Cc}]/u.test(raw)) {
    return {
      value: null,
      problem: {
        variable,
        message: `${variable} must not contain whitespace or control characters.`,
      },
    };
  }
  if (raw.length < MIN_TOKEN_LENGTH) {
    return {
      value: null,
      problem: {
        variable,
        message: `${variable} must be at least ${MIN_TOKEN_LENGTH} characters; generate one with "openssl rand -base64 32".`,
      },
    };
  }
  return { value: raw, problem: null };
}

function switchValue(
  env: ConfigEnv,
  variable: string,
): { value: boolean; problem: ConfigProblem | null } {
  const raw = env[variable];
  if (raw === undefined) return { value: false, problem: null };
  const value = raw.trim();
  if (value === "" || value === "0") return { value: false, problem: null };
  if (value === "1") return { value: true, problem: null };
  return {
    value: false,
    problem: { variable, message: `${variable} must be "1" or "0", got "${value}".` },
  };
}

/**
 * `*` or a comma-separated list of origins. A path, query or fragment would
 * never match a browser's `Origin` header, so it is refused instead of ignored.
 */
function allowedOrigins(env: ConfigEnv): { value: string[]; problems: ConfigProblem[] } {
  const raw = env.SUITE_ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim().length === 0) return { value: ["*"], problems: [] };
  const problems: ConfigProblem[] = [];
  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    const origin = entry.trim();
    if (origin.length === 0) continue;
    if (origin === "*") {
      origins.push(origin);
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push({
        variable: "SUITE_ALLOWED_ORIGINS",
        message: `SUITE_ALLOWED_ORIGINS entry "${origin}" is not an origin such as https://canvas.example.com.`,
      });
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      problems.push({
        variable: "SUITE_ALLOWED_ORIGINS",
        message: `SUITE_ALLOWED_ORIGINS entry "${origin}" must use http or https.`,
      });
      continue;
    }
    if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
      problems.push({
        variable: "SUITE_ALLOWED_ORIGINS",
        message: `SUITE_ALLOWED_ORIGINS entry "${origin}" must be an origin without a path.`,
      });
      continue;
    }
    origins.push(parsed.origin);
  }
  return { value: origins.length > 0 ? origins : ["*"], problems };
}

function urlProblem(env: ConfigEnv): ConfigProblem | null {
  const raw = text(env, "SUITE_PUBLIC_URL");
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return null;
  } catch {
    // Reported below.
  }
  return {
    variable: "SUITE_PUBLIC_URL",
    message: "SUITE_PUBLIC_URL must be an http or https URL such as https://canvas.example.com.",
  };
}

/**
 * The control plane's origin. It is both the `iss`/`aud` the session JWT carries
 * and the base of the JWKS URL, so a typo has to be a startup error: otherwise
 * every join is refused with no clue which side is wrong.
 */
function authUrlValue(env: ConfigEnv): {
  value: string | null;
  problem: ConfigProblem | null;
} {
  const raw = text(env, "SUITE_AUTH_URL");
  if (raw === null || raw.length === 0) return { value: null, problem: null };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { value: parsed.origin, problem: null };
    }
  } catch {
    // Reported below.
  }
  return {
    value: null,
    problem: {
      variable: "SUITE_AUTH_URL",
      message:
        "SUITE_AUTH_URL must be an http or https origin such as https://accounts.example.com.",
    },
  };
}

/**
 * A hosted relay signs licences, so it cannot validate them without a key. The
 * check parses the value exactly as `licence.ts` will, so a typo is a startup
 * error rather than a claim refused later with "no public key".
 */
function licenceKey(
  env: ConfigEnv,
  hosted: boolean,
): { value: string | null; problem: ConfigProblem | null } {
  const raw = text(env, "SUITE_LICENCE_PUBLIC_KEY");
  const value = raw !== null && raw.length > 0 ? raw : null;
  if (value === null) {
    return {
      value: null,
      problem: hosted
        ? {
            variable: "SUITE_LICENCE_PUBLIC_KEY",
            message:
              "SUITE_LICENCE_PUBLIC_KEY is required when SUITE_HOSTED=1; a relay cannot verify licences without it.",
          }
        : null,
    };
  }
  if (parseLicencePublicKey(value) === null) {
    return {
      value: null,
      problem: {
        variable: "SUITE_LICENCE_PUBLIC_KEY",
        message:
          "SUITE_LICENCE_PUBLIC_KEY is not a usable Ed25519 public key; paste the PEM block or the base64url raw key from `pnpm --filter @suite/collab-server licence`.",
      },
    };
  }
  return { value, problem: null };
}

/** Version stamps from a tag are short and printable; anything else is a typo. */
function versionProblem(env: ConfigEnv): ConfigProblem | null {
  const raw = env.SUITE_VERSION;
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value.length === 0) {
    return {
      variable: "SUITE_VERSION",
      message: "SUITE_VERSION is empty; unset it to use the version in package.json.",
    };
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(value)) {
    return {
      variable: "SUITE_VERSION",
      message: "SUITE_VERSION must be a short version string such as 1.4.0 or v1.4.0-rc.1.",
    };
  }
  return null;
}

function logLevel(env: ConfigEnv): { value: LogLevel; problem: ConfigProblem | null } {
  const raw = text(env, "SUITE_LOG_LEVEL");
  if (raw === null) return { value: "info", problem: null };
  const value = raw.toLowerCase();
  const match = logLevels.find((level) => level === value);
  if (match) return { value: match, problem: null };
  return {
    value: "info",
    problem: {
      variable: "SUITE_LOG_LEVEL",
      message: `SUITE_LOG_LEVEL must be one of ${logLevels.join(", ")}, got "${raw}".`,
    },
  };
}

/**
 * Reads, type-checks and defaults the whole configuration. `problems` is empty
 * exactly when the process may start; every entry names the variable at fault
 * and never repeats a credential.
 */
export function validateConfig(env: ConfigEnv = process.env): ConfigResult {
  const problems: ConfigProblem[] = [];
  const fail = (problem: ConfigProblem | null): void => {
    if (problem) problems.push(problem);
  };

  const wsPort = port(env, "PORT", DEFAULT_PORTS.ws);
  const healthPort = port(env, "HEALTH_PORT", DEFAULT_PORTS.health);
  fail(wsPort.problem);
  fail(healthPort.problem);
  if (wsPort.value === healthPort.value && wsPort.problem === null && healthPort.problem === null) {
    problems.push({
      variable: "HEALTH_PORT",
      message: `PORT and HEALTH_PORT are both ${wsPort.value}; the sync server and the HTTP API need separate ports.`,
    });
  }

  const readPaths = {} as Record<DatabaseName, string | null>;
  for (const name of ["documents", "shares", "workspaces"] as const) {
    const read = databasePath(env, name, DEFAULT_DATABASE_PATHS[name]);
    readPaths[name] = read.value;
    problems.push(...read.problems);
  }
  for (const name of ["settings", "licences", "attachments"] as const) {
    const read = databasePath(env, name, null);
    readPaths[name] = read.value;
    problems.push(...read.problems);
  }
  const seen = new Map<string, DatabaseName>();
  for (const name of Object.keys(readPaths) as DatabaseName[]) {
    const path = readPaths[name];
    if (path === null || path === MEMORY_PATH) continue;
    const clash = seen.get(path);
    if (clash !== undefined) {
      problems.push({
        variable: DATABASE_ENV[name],
        message: `${DATABASE_ENV[name]} points at the same file as ${DATABASE_ENV[clash]} ("${path}"); each store needs its own file.`,
      });
      continue;
    }
    seen.set(path, name);
  }

  const requireDurable = switchValue(env, "SUITE_REQUIRE_DURABLE_STORES");
  fail(requireDurable.problem);
  if (requireDurable.value) problems.push(...durableStoreProblems(env, readPaths));

  const admin = token(env, "SUITE_ADMIN_TOKEN");
  const adminRead = token(env, "SUITE_ADMIN_READ_TOKEN");
  const projection = token(env, "SUITE_PROJECTION_TOKEN");
  const source = token(env, "SUITE_SOURCE_TOKEN");
  const legacyInternal = token(env, "SUITE_INTERNAL_TOKEN");
  for (const read of [admin, adminRead, projection, source, legacyInternal]) fail(read.problem);

  const hosted = switchValue(env, "SUITE_HOSTED");
  fail(hosted.problem);
  const trustProxy = switchValue(env, "SUITE_TRUST_PROXY");
  fail(trustProxy.problem);
  fail(versionProblem(env));

  const licence = licenceKey(env, hosted.value);
  fail(licence.problem);
  fail(urlProblem(env));
  const auth = authUrlValue(env);
  fail(auth.problem);

  const origins = allowedOrigins(env);
  problems.push(...origins.problems);

  const level = logLevel(env);
  fail(level.problem);

  const rateLimits = {} as ServerConfig["rateLimits"];
  for (const key of Object.keys(RATE_LIMIT_ENV) as (keyof typeof RATE_LIMIT_ENV)[]) {
    const variable = RATE_LIMIT_ENV[key];
    const raw = env[variable];
    if (raw === undefined || raw.trim().length === 0) {
      rateLimits[key] = RATE_LIMIT_DEFAULTS[key];
      continue;
    }
    const parsed = positiveInteger(raw.trim(), variable, RATE_LIMIT_DEFAULTS[key], {
      max: 1_000_000,
    });
    rateLimits[key] = parsed.value;
    fail(parsed.problem);
  }

  const resolved = resolveLimits(env, null);
  for (const problem of resolved.problems) {
    const variable = LIMIT_KEYS.map((key) => LIMIT_ENV[key]).find((name) => problem.includes(name));
    problems.push({ variable: variable ?? "limits", message: problem });
  }
  const contradiction = limitsProblem(resolved.limits);
  if (contradiction !== null) problems.push({ variable: "limits", message: contradiction });

  return {
    ok: problems.length === 0,
    problems,
    config: {
      version: serverVersion(env),
      hosted: hosted.value,
      ports: { ws: wsPort.value, health: healthPort.value },
      paths: {
        documents: readPaths.documents ?? DEFAULT_DATABASE_PATHS.documents,
        shares: readPaths.shares ?? DEFAULT_DATABASE_PATHS.shares,
        workspaces: readPaths.workspaces ?? DEFAULT_DATABASE_PATHS.workspaces,
        settings: readPaths.settings,
        licences: readPaths.licences,
        attachments: readPaths.attachments,
      },
      tokens: {
        admin: admin.value,
        adminRead: adminRead.value,
        projection: projection.value ?? legacyInternal.value,
        source: source.value,
      },
      licencePublicKey: licence.value,
      authUrl: auth.value,
      allowedOrigins: origins.value,
      trustProxy: trustProxy.value,
      logLevel: level.value,
      rateLimits,
      limits: resolved.limits,
    },
  };
}
