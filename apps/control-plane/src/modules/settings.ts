import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "@suite/billing";
import {
  encryptSetting,
  GLOBAL_SCOPE,
  orgScope,
  resolveAll,
  SECRET_MASK,
  SETTINGS,
  type StoredSetting,
  settingDefinition,
} from "@suite/settings";
import { Pool } from "pg";
import type { AccountSession } from "../../../../services/auth/src/types.js";
import { type ConfigEnv, DATABASE_URL_VARIABLE } from "../config.js";
import { createLogger, type Logger } from "../logging.js";
import type { RouteModule } from "../routes.js";
import { sessionReader } from "./context.js";

/**
 * The settings the panel edits, and the one place their precedence is applied.
 *
 * Every value here is something the app can re-read on the next request, which is why it can
 * live in a table rather than in the environment: Stripe keys and the mode that picks between
 * them, the mail transport, the licence key, the backup bucket, the flags. What cannot live
 * here is the handful of values the process needs *before* it can read a row, and
 * `BOOTSTRAP_VARIABLES` in `@suite/settings` names them.
 *
 * ## Panel wins
 *
 * An organization's row beats the deployment's, which beats the environment, which beats the
 * default. The environment is a boot default, not a ceiling: a deployment that once exported
 * `STRIPE_SECRET_KEY` is not frozen at that value, and a read says which level answered so
 * nobody has to guess why a field shows what it shows.
 *
 * ## Secrets are write-only
 *
 * A secret is stored encrypted with `SUITE_SETTINGS_KEY`, read as a mask, and decrypted only
 * inside a process. A read that could return one would turn a screenshot into a credential.
 */
export const SETTINGS_PATH = "/admin/settings";

export interface SettingsModuleOptions {
  env: ConfigEnv;
  logger: Logger;
  /** Injected by a test so the SQL runs against a stub rather than a live database. */
  pool?: Pick<Pool, "query"> | undefined;
}

interface SettingsRow {
  scope: string;
  key: string;
  value: string;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS suite_settings (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    updated_by TEXT,
    PRIMARY KEY (scope, key)
  )
`;

const SELECT_ROWS = `
  SELECT scope, key, value
  FROM suite_settings
  ORDER BY scope, key
`;

const UPSERT = `
  INSERT INTO suite_settings (scope, key, value, updated_at, updated_by)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (scope, key)
  DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at,
                updated_by = EXCLUDED.updated_by
`;

const DELETE_ROW = `
  DELETE FROM suite_settings
  WHERE scope = $1 AND key = $2
`;

/** Reads every stored row, creating the table so an older database still boots. */
async function readRows(database: Pick<Pool, "query">): Promise<StoredSetting[]> {
  await database.query(CREATE_TABLE);
  const result = await database.query(SELECT_ROWS);
  return (result.rows as SettingsRow[]).map((row) => ({
    scope: row.scope,
    key: row.key,
    value: row.value,
  }));
}

/**
 * The value to store for one key.
 *
 * A secret is encrypted here, which is the only place a plaintext secret leaves the body.
 * Everything else is stored as written, so the panel can show the string an operator typed
 * even when it does not parse.
 */
function storedValue(secretKey: string, key: string, raw: unknown): string {
  const definition = settingDefinition(key);
  if (!definition) throw new Error(`unknown setting ${key}`);
  const text = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw ?? "");
  if (definition.kind === "secret" && text.length > 0) return encryptSetting(secretKey, text);
  return text;
}

/**
 * What a read returns: every declared key, in registry order, with its value and the level
 * that supplied it. A secret is a mask and nothing else.
 */
export function settingsBody(rows: readonly StoredSetting[], organizationId: string | null) {
  const resolved = resolveAll({ rows, organizationId, env: process.env });
  return {
    organizationId,
    settings: SETTINGS.map((definition) => {
      const entry = resolved.find((candidate) => candidate.key === definition.key);
      return {
        key: definition.key,
        group: definition.group,
        kind: definition.kind,
        help: definition.help,
        overridable: definition.overridable === true,
        ...(definition.values ? { values: definition.values } : {}),
        value: definition.kind === "secret" ? SECRET_MASK : (entry?.value ?? null),
        source: entry?.source ?? "default",
        env: definition.env ?? "",
      };
    }),
  };
}

export function createSettingsModule(options: SettingsModuleOptions): RouteModule {
  const { env, logger } = options;
  const databaseUrl = (env[DATABASE_URL_VARIABLE] ?? "").trim();
  const secretKey = (): string => (process.env.SUITE_SETTINGS_KEY ?? "").trim();
  let pool: Pick<Pool, "query"> | null = options.pool ?? null;
  const database = (): Pick<Pool, "query"> => {
    if (pool === null) pool = new Pool({ connectionString: databaseUrl, max: 2 });
    return pool;
  };

  const refuse = (response: ServerResponse, status: number, error: string, message: string) => {
    sendJson(response, status, { ok: false, error, message });
  };

  /** The operator gate, with the session it admitted so a write can name the actor. */
  const operator = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<AccountSession | null> => {
    const read = sessionReader();
    if (read === null) {
      refuse(response, 503, "auth-not-configured", "the account module is not running here");
      return null;
    }
    const session = await read(headersOf(request));
    if (session === null) {
      response.setHeader("www-authenticate", "Session");
      refuse(response, 401, "unauthorized", "sign in to change settings");
      return null;
    }
    if (!session.operator) {
      logger.warn("a settings route was refused", { result: "refused-not-operator" });
      refuse(response, 403, "forbidden", "this account is not an operator on this deployment");
      return null;
    }
    return session;
  };

  return {
    name: "settings",
    async handle(request, response): Promise<boolean> {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== SETTINGS_PATH && !url.pathname.startsWith(`${SETTINGS_PATH}/`)) {
        return false;
      }

      const session = await operator(request, response);
      if (session === null) return true;
      if (databaseUrl.length === 0) {
        refuse(response, 503, "storage-not-configured", "no control-plane database is configured");
        return true;
      }

      const organizationId = url.searchParams.get("organization")?.trim() || null;
      const rawKey = url.pathname.slice(SETTINGS_PATH.length + 1);

      if (request.method === "GET" && rawKey.length === 0) {
        sendJson(response, 200, settingsBody(await readRows(database()), organizationId));
        return true;
      }

      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        refuse(response, 400, "invalid-key", "the setting name is not valid URL encoding");
        return true;
      }
      const definition = settingDefinition(key);
      if (definition === null) {
        refuse(response, 404, "unknown-setting", `"${key}" is not a setting`);
        return true;
      }

      const scope = organizationId === null ? GLOBAL_SCOPE : orgScope(organizationId);
      if (organizationId !== null && definition.overridable !== true) {
        refuse(response, 400, "not-overridable", `${key} is deployment-wide`);
        return true;
      }

      if (request.method === "PUT") {
        // `readJsonBody` is a Result at this boundary, so a malformed body is a refusal
        // rather than a throw inside the handler.
        const parsed = await readJsonBody(request);
        if (parsed.isErr()) {
          refuse(response, 400, "invalid-body", "the body must be JSON");
          return true;
        }
        const body = parsed.value;
        const value =
          typeof body === "object" && body !== null
            ? (body as { value?: unknown }).value
            : undefined;
        if (value === undefined) {
          refuse(response, 400, "invalid-body", "expected { value }");
          return true;
        }
        if (definition.kind === "enum" && definition.values) {
          if (typeof value !== "string" || !definition.values.includes(value)) {
            refuse(
              response,
              400,
              "invalid-value",
              `${key} accepts ${definition.values.join(", ")}`,
            );
            return true;
          }
        }
        if (definition.kind === "secret" && secretKey().length === 0) {
          refuse(
            response,
            503,
            "settings-key-missing",
            "SUITE_SETTINGS_KEY is required to store a secret",
          );
          return true;
        }
        await database().query(CREATE_TABLE);
        await database().query(UPSERT, [
          scope,
          key,
          storedValue(secretKey(), key, value),
          Date.now(),
          session.userId,
        ]);
        logger.info("setting written", { key, scope, actor: session.userId });
        sendJson(response, 200, { ok: true, key, scope });
        return true;
      }

      if (request.method === "DELETE") {
        await database().query(CREATE_TABLE);
        await database().query(DELETE_ROW, [scope, key]);
        logger.info("setting reset", { key, scope, actor: session.userId });
        sendJson(response, 200, { ok: true, key, scope });
        return true;
      }

      refuse(response, 405, "method-not-allowed", "use GET, PUT or DELETE");
      return true;
    },
  };
}

function headersOf(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

/** The mounted module. */
export const module: RouteModule = createSettingsModule({
  env: process.env,
  logger: createLogger(),
});
