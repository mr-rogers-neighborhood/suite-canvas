import type { IncomingMessage, ServerResponse } from "node:http";
import { parseTierTable, readJsonBody, sendJson } from "@suite/billing";
import {
  encryptSetting,
  envWithSettings,
  GLOBAL_SCOPE,
  orgScope,
  resolveAll,
  SECRET_MASK,
  SETTINGS,
  type StoredSetting,
  settingDefinition,
} from "@suite/settings";
import type { Pool } from "pg";
import type { AccountSession } from "../../../../services/auth/src/types.js";
import { type ConfigEnv, DATABASE_URL_VARIABLE } from "../config.js";
import { createLogger, type Logger } from "../logging.js";
import { createPool } from "../pool.js";
import type { RouteModule } from "../routes.js";
import { type AuditStore, auditSafely, createAuditStore } from "./audit.js";
import { billingProfiles } from "./auth-billing.js";
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
  /** The audit trail. A test passes a memory store; the default shares this module's pool. */
  audit?: AuditStore | undefined;
}

interface SettingsRow {
  scope: string;
  key: string;
  value: string;
  updated_at: number | string | null;
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
  SELECT scope, key, value, updated_at
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
    updatedAt: row.updated_at === null ? null : Number(row.updated_at),
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
export function settingsBody(
  rows: readonly StoredSetting[],
  organizationId: string | null,
  bootedAt: number = Date.now() - Math.round(process.uptime() * 1000),
  /*
   * The process's own environment, which is where the `_LIVE` half of a Stripe profile is
   * read from when nobody has typed it into a row yet. A test passes its own.
   */
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const resolved = resolveAll({ rows, organizationId, env: process.env });
  const savedAt = new Map(
    (rows as (StoredSetting & { updatedAt?: number | null })[]).map((row) => [
      `${row.scope}\u0000${row.key}`,
      row.updatedAt ?? null,
    ]),
  );
  return {
    organizationId,
    /**
     * When this process started.
     *
     * Billing and mail are read once, at boot, which is a fact the panel has to be able to
     * state: without it an operator saves a key, sees the row, and waits for something to
     * happen that cannot happen until the process is restarted.
     */
    bootedAt,
    /**
     * Both Stripe profiles, with what each one still lacks.
     *
     * Billing is one of the two things read at boot, and the switch between test and live
     * is the switch that decides whether anybody is charged at all. Reporting readiness
     * here is what makes the switch safe to press: a profile that is incomplete is named
     * before it is chosen rather than discovered by a deployment that went quiet.
     */
    billing: billingProfiles(envWithSettings({ env, rows })),
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
        // The row's own write time, so the panel can say "saved after boot, restart".
        savedAt: savedAt.get(`global\u0000${definition.key}`) ?? null,
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
    if (pool === null) pool = createPool({ connectionString: databaseUrl, max: 2 });
    return pool;
  };

  const refuse = (response: ServerResponse, status: number, error: string, message: string) => {
    sendJson(response, status, { ok: false, error, message });
  };

  // The same pool the settings table uses: one connection budget per module, and a test
  // that stubs the pool absorbs the audit rows too.
  let auditStore: AuditStore | null = options.audit ?? null;
  const audit = (): AuditStore => {
    auditStore ??= createAuditStore(database());
    return auditStore;
  };

  /**
   * A write is an act worth keeping, and a secret's *value* never is.
   *
   * The row says which key moved from what to what; a secret records only that it was
   * replaced, because an audit table that holds a credential is a second place to leak it
   * from.
   */
  const record = (entry: {
    actor: string;
    action: string;
    target: string;
    outcome: string;
    details?: Record<string, unknown>;
  }) =>
    auditSafely(audit(), entry, (error) =>
      logger.error("the audit row did not write", {
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

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
        sendJson(
          response,
          200,
          settingsBody(await readRows(database()), organizationId, undefined, env),
        );
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
        // A mode whose credentials are incomplete would boot with billing off, which on a
        // deployment that charges people means everyone syncs for free. The order the
        // panel states is the order this enforces: fill the profile, then switch.
        if (key === "billing.mode") {
          // The candidate mode, laid over the rows as they are now: the question is what
          // the *next boot* would spend, not what this process is spending.
          const candidate = envWithSettings({
            env: { ...env, SUITE_BILLING_MODE: String(value) },
            rows: await readRows(database()),
          });
          // The guard is only about the case with money in it. With billing off nothing is
          // charged either way, so the mode is free to set; with it on, a mode whose
          // credentials are incomplete boots billing off, which on a live deployment means
          // everyone syncs for free while the panel says nothing is wrong.
          const flag = (candidate.SUITE_BILLING_ENABLED ?? "").trim().toLowerCase();
          const profile =
            billingProfiles(candidate).profiles[String(value) === "live" ? "live" : "test"];
          if ((flag === "1" || flag === "true") && !profile.complete) {
            const missing = [
              ...profile.missing,
              ...(profile.problem === null ? [] : [profile.problem]),
            ];
            refuse(
              response,
              400,
              "billing-profile-incomplete",
              `The ${String(value)} profile is not ready: ${missing.join(", ")}`,
            );
            return true;
          }
        }
        // A price table that does not parse is a checkout that fails for a customer, so it
        // is refused at the write rather than at the next boot.
        if (key.startsWith("billing.stripe.prices.")) {
          const parsedTable = parseTierTable(String(value));
          if (parsedTable.isErr()) {
            refuse(response, 400, "invalid-value", parsedTable.error.message);
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
        await record({
          actor: session.userId,
          action: "settings.write",
          target: key,
          outcome: "ok",
          details: {
            scope,
            ...(definition.kind === "secret" ? { secret: true } : { value: String(value) }),
          },
        });
        logger.info("setting written", { key, scope, actor: session.userId });
        sendJson(response, 200, { ok: true, key, scope });
        return true;
      }

      if (request.method === "DELETE") {
        await database().query(CREATE_TABLE);
        await database().query(DELETE_ROW, [scope, key]);
        await record({
          actor: session.userId,
          action: "settings.reset",
          target: key,
          outcome: "ok",
          details: { scope },
        });
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

/**
 * Every stored row, read once by a caller that is not serving a settings request.
 *
 * The boot uses this to compose the environment billing and mail are built from: those two
 * read their values once, so a saved row has to be in place before the plugin exists. A
 * deployment with no database, or one whose table is not there yet, answers with no rows —
 * which is exactly "nothing has been saved", so boot proceeds on the environment.
 */
export async function readStoredSettings(databaseUrl: string): Promise<StoredSetting[]> {
  if (databaseUrl.trim().length === 0) return [];
  const pool = createPool({ connectionString: databaseUrl, max: 1 });
  try {
    return await readRows(pool);
  } catch {
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
}
