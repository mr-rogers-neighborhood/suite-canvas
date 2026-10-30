import type { IncomingMessage, ServerResponse } from "node:http";
import { mailTransportFromEnv } from "@suite/auth";
import { readJsonBody, sendJson } from "@suite/billing";
import { envWithSettings } from "@suite/settings";
import type { Pool } from "pg";
import { type ConfigEnv, DATABASE_URL_VARIABLE } from "../config.js";
import { createLogger, type Logger } from "../logging.js";
import { createPool } from "../pool.js";
import type { RouteModule } from "../routes.js";
import { ADMISSIONS_PATH, createAdmissionsHandler } from "./adminAdmissions.js";
import {
  createTemplatesHandler,
  MAX_TEMPLATE_BODY_BYTES,
  TEMPLATES_PATH,
} from "./adminTemplates.js";
import { type AuditStore, auditSafely, createAuditStore } from "./audit.js";
import { stripeMode } from "./auth-billing.js";
import { sessionReader } from "./context.js";
import { readStoredSettings } from "./settings.js";

/**
 * The operator surface: one admission queue and one starter-template list.
 *
 * Admission is a person reading a list and deciding, so the list and the decision
 * need a door that is not a psql session. Starter templates need the same door to be
 * written, and a public one to be read: the launcher draws the gallery before anybody
 * has signed in, so a credential there would only be a credential baked into a client.
 * Those are the whole subject matter of this module. A route that could also read every
 * workspace would turn one leaked session into every tenant's documents, and the
 * account service is the process with an account database, not a console. A template
 * is public content by construction — that is what makes it the one thing here that
 * may be served without a sign-in.
 *
 * ## The door is an account, not a token
 *
 * These routes answer the *session* the auth module resolves, and only for an account
 * this deployment named in `SUITE_ADMIN_EMAILS`. A shared bearer token was the old
 * door, and it had the two flaws any env token has: it could not be revoked without a
 * restart, and it said nothing about *who* acted beyond the word "admin" in an audit
 * line. The session carries the address, so the log and the panel agree on the person.
 *
 * `SUITE_ADMISSION_REQUIRED` with no operator nominated is a deployment that can hold
 * people it can never let in, so the boot refuses that pairing (see
 * `adminMisconfigured`).
 */

/** The addresses this deployment treats as operators; empty means nobody. */
export const OPERATOR_EMAILS_VARIABLE = "SUITE_ADMIN_EMAILS";
export { ADMISSIONS_PATH, APP_URL_VARIABLE } from "./adminAdmissions.js";

/** The operator's people list, and the one thing it may change: a support grant it revokes. */
export const ACCOUNTS_PATH = "/admin/accounts";

/** One message, to prove the deployment can send one. */
export const MAIL_TEST_PATH = "/admin/mail/test";

/** What operators have done, newest first. */
export const ACTIVITY_PATH = "/admin/activity";

/**
 * Who is paying, and what for.
 *
 * A subscription belongs to an *organization*, not a workspace and not a person, and that
 * distinction is the one operators get wrong: nothing in this panel is per workspace, and
 * nothing here changes a plan. The list exists so "is anyone paying?" is a press rather
 * than an SSH session and a psql prompt.
 */
export const SUBSCRIPTIONS_PATH = "/admin/subscriptions";

export { ADMIN_TEMPLATES_PATH, TEMPLATES_PATH } from "./adminTemplates.js";

/** A timestamp column, as a number: `pg` hands back a Date, a string or a number. */
function millisOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** One row of the subscription list, as the query above returns it. */
interface SubscriptionRow {
  organization_id: string;
  organization_name: string | null;
  plan: string;
  status: string;
  periodEnd: string | Date | number | null;
  cancelAtPeriodEnd: boolean | null;
  seats: number | string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/** One row of the people list, as the query above returns it. */
interface AccountRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  createdAt: string | Date | null;
  twoFactorEnabled: boolean | null;
  granted_at: string | number | null;
  revoked_at: string | number | null;
}

export interface AdminModuleOptions {
  env: ConfigEnv;
  logger: Logger;
  /** The pool is injectable so a test drives the SQL against a stub, not a server. */
  pool?: Pick<Pool, "query"> | undefined;
  /** The audit trail. Defaults to this module's pool; a test passes a memory store. */
  audit?: AuditStore | undefined;
}

/**
 * The people list: what the panel needs to offer impersonation and to end it.
 *
 * The grant columns ride along with the account, so one query answers "who is this and may
 * support look in right now". `$1` is the search term; an empty one lists everyone.
 */
const ACCOUNTS_SQL = `
  SELECT u.id, u.email, u.name, u.role, u."createdAt", u."twoFactorEnabled",
         g.granted_at, g.revoked_at
  FROM "user" u
  LEFT JOIN operator_support_grants g ON g.user_id = u.id
  WHERE $1 = '' OR u.email ILIKE '%' || $1 || '%' OR COALESCE(u.name, '') ILIKE '%' || $1 || '%'
  ORDER BY u."createdAt" DESC
  LIMIT 50
`;

/** Kept beside the query it serves: the panel may not assume the grants table exists. */
const GRANTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS operator_support_grants (
    user_id TEXT PRIMARY KEY,
    granted_at BIGINT NOT NULL,
    revoked_at BIGINT
  )
`;

const REVOKE_GRANT_SQL = `
  UPDATE operator_support_grants
  SET revoked_at = $2
  WHERE user_id = $1 AND revoked_at IS NULL
`;

/**
 * Every subscription row, with the organization it belongs to.
 *
 * Live rows first, then the newest period: the same rule `LIVE_SUBSCRIPTION_SQL` uses to
 * pick the one that counts, so the panel cannot show a cancelled row above the one being
 * paid for. `NULLS LAST` matters because a subscription that has not been through a period
 * yet has no end.
 */
const SUBSCRIPTIONS_SQL = `
  SELECT s."referenceId" AS organization_id, s."plan", s."status",
         s."periodEnd", s."cancelAtPeriodEnd", s."seats",
         s."stripeCustomerId", s."stripeSubscriptionId",
         o.name AS organization_name
  FROM "subscription" s
  LEFT JOIN "organization" o ON o.id = s."referenceId"
  ORDER BY
    CASE WHEN s."status" IN ('active', 'trialing') THEN 0 ELSE 1 END,
    s."periodEnd" DESC NULLS LAST
  LIMIT 200
`;

/**
 * A request's headers as a plain record, which is what the session reader takes.
 *
 * The reader is Better Auth's own `getSession`, so it wants the `cookie` (or an
 * `authorization` bearer) it would have got from the HTTP layer. Node gives repeated
 * headers as an array; joining them with ", " is the wire form, and a cookie header
 * never repeats in practice.
 */
function headersOf(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(", ");
  }
  return headers;
}

/** The request's method, uppercased, with the HTTP default for a request that names none. */
function methodOf(request: IncomingMessage): string {
  return (request.method ?? "GET").toUpperCase();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether this deployment can hold accounts it cannot release.
 *
 * Returned as a sentence rather than thrown from module load: a bad pairing is an
 * operator error to read in `/health` and in the boot log, not a crash loop that
 * hides the reason.
 */
export function adminMisconfigured(env: ConfigEnv): string | null {
  const required = (env.SUITE_ADMISSION_REQUIRED ?? "").trim().toLowerCase();
  const queueOn = required === "1" || required === "true";
  const operators = operatorEmailsOf(env);
  if (queueOn && operators.length === 0) {
    return `SUITE_ADMISSION_REQUIRED is on but ${OPERATOR_EMAILS_VARIABLE} names no operator, so nobody could be admitted`;
  }
  return null;
}

/** `SUITE_ADMIN_EMAILS`, parsed once per boot: the only list this module trusts. */
function operatorEmailsOf(env: ConfigEnv): readonly string[] {
  return (env[OPERATOR_EMAILS_VARIABLE] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function createAdminModule(options: AdminModuleOptions): RouteModule {
  const { env, logger } = options;
  const databaseUrl = (env[DATABASE_URL_VARIABLE] ?? "").trim();
  let pool: Pick<Pool, "query"> | null = options.pool ?? null;
  const database = (): Pick<Pool, "query"> => {
    if (pool === null) pool = createPool({ connectionString: databaseUrl, max: 2 });
    return pool;
  };

  const refuse = (response: ServerResponse, status: number, error: string, message: string) => {
    sendJson(response, status, { ok: false, error, message });
  };

  let trail: AuditStore | null = options.audit ?? null;
  const audit = (): AuditStore => {
    trail ??= createAuditStore(database());
    return trail;
  };

  /**
   * One row per act on somebody else's account or data.
   *
   * `operatorGate` has already resolved who is calling by the time these run, so the actor
   * is the account the deployment named an operator rather than the word "admin".
   */
  const record = (
    actor: string,
    entry: {
      action: string;
      target: string;
      outcome: string;
      details?: Record<string, unknown>;
    },
  ) =>
    auditSafely(audit(), { actor, ...entry }, (error) =>
      logger.error("the audit row did not write", {
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

  /**
   * True when the caller is a signed-in account this deployment named as an operator.
   *
   * Three refusals, each a different fact. No operator list is a deployment that has
   * not said who may act, so the routes are not configured (503) rather than forbidden.
   * No session is a person who is not signed in (401). A session that is not on the
   * list is a signed-in account asking for a door it does not hold (403) — and it is
   * logged with the address, because "somebody tried" is the line an operator wants.
   */
  const operatorGate = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const operators = operatorEmailsOf(env);
    if (operators.length === 0) {
      refuse(
        response,
        503,
        "admin-not-configured",
        `${OPERATOR_EMAILS_VARIABLE} names no operator`,
      );
      return false;
    }
    const read = sessionReader();
    if (read === null) {
      refuse(response, 503, "auth-not-configured", "the account module is not running here");
      return false;
    }
    const session = await read(headersOf(request));
    if (session === null) {
      response.setHeader("www-authenticate", "Session");
      refuse(response, 401, "unauthorized", "sign in to use the operator surface");
      return false;
    }
    if (!session.operator) {
      logger.warn("an operator route was refused", {
        path: new URL(request.url ?? "/", "http://localhost").pathname,
        result: "refused-not-operator",
      });
      refuse(response, 403, "forbidden", "this account is not an operator on this deployment");
      return false;
    }
    return true;
  };

  /** True when this process knows where the database is; a route cannot answer without it. */
  const storageGate = (response: ServerResponse): boolean => {
    if (databaseUrl.length !== 0) return true;
    refuse(response, 503, "admin-not-configured", `${DATABASE_URL_VARIABLE} is not set`);
    return false;
  };

  const methodNotAllowed = (response: ServerResponse, allow: string, method: string): void => {
    response.setHeader("allow", allow);
    refuse(response, 405, "method_not_allowed", `${method} is not supported`);
  };

  const admissionsHandler = createAdmissionsHandler({
    env,
    logger,
    database,
    operatorGate,
    storageGate,
    refuse,
    methodNotAllowed,
  });

  const templatesHandler = createTemplatesHandler({
    logger,
    database,
    operatorGate,
    storageGate,
    refuse,
    methodNotAllowed,
  });

  /**
   * The people list. Reading it is what lets the operator pick a target; it carries no
   * workspace content, and the grant columns say who has already allowed support in.
   */
  const listAccounts = async (request: IncomingMessage, response: ServerResponse) => {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams.get("q") ?? "";
    try {
      await database().query(GRANTS_TABLE_SQL);
      const result = await database().query(ACCOUNTS_SQL, [query.trim()]);
      sendJson(response, 200, {
        ok: true,
        accounts: (result.rows as AccountRow[]).map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          createdAt: row.createdAt,
          twoFactorEnabled: row.twoFactorEnabled === true,
          supportAccess: {
            granted: row.granted_at !== null && row.revoked_at === null,
            grantedAt: row.granted_at === null ? null : Number(row.granted_at),
            revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
          },
        })),
      });
    } catch (error) {
      logger.error("the people list did not read", { error: messageOf(error) });
      refuse(response, 500, "accounts-unavailable", "the people list could not be read");
    }
  };

  /**
   * Ending support access. The operator may only take it away: granting is the account's
   * own act, and a panel that could grant it would make the consent a formality.
   */
  const revokeSupportAccess = async (
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ) => {
    const body = await readJsonBody(request, MAX_TEMPLATE_BODY_BYTES).catch(() => null);
    const parsed = body?.isOk() === true ? (body.value as { granted?: unknown }) : null;
    if (parsed?.granted === true) {
      refuse(
        response,
        403,
        "consent-is-the-accounts",
        "support access is granted by the account itself, from its own settings",
      );
      return;
    }
    try {
      await database().query(GRANTS_TABLE_SQL);
      await database().query(REVOKE_GRANT_SQL, [id, Date.now()]);
      const actor = (await sessionReader()?.(headersOf(request)))?.userId ?? "operator";
      await record(actor, {
        action: "support-access.revoke",
        target: id,
        outcome: "ok",
        details: { by: "operator" },
      });
      logger.info("support access revoked by an operator", { account: id });
      sendJson(response, 200, { ok: true, granted: false });
    } catch (error) {
      logger.error("the support grant did not revoke", { error: messageOf(error) });
      refuse(response, 500, "grant-unavailable", "the support grant could not be revoked");
    }
  };

  /**
   * The account named by `/admin/accounts/<id>/support-access`.
   *
   * `null` is "not this route"; `undefined` is a malformed id, already refused.
   */
  const supportAccessId = (path: string, response: ServerResponse): string | null | undefined => {
    const prefix = `${ACCOUNTS_PATH}/`;
    if (!path.startsWith(prefix)) return null;
    const [segment, ...rest] = path.slice(prefix.length).split("/");
    if (segment === undefined || segment.length === 0) return null;
    if (rest.join("/") !== "support-access") return null;
    try {
      return decodeURIComponent(segment);
    } catch {
      refuse(
        response,
        400,
        "invalid-request",
        "the account id in the path is not valid URL encoding",
      );
      return undefined;
    }
  };

  /**
   * The trail, newest first.
   *
   * `before` is the `(at, id)` watermark of the last row a reader has, so the next page
   * continues exactly where the last one stopped even when two acts share a millisecond.
   */
  const listActivity = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const at = Number.parseInt(url.searchParams.get("beforeAt") ?? "", 10);
    const id = Number.parseInt(url.searchParams.get("beforeId") ?? "", 10);
    const before = Number.isFinite(at) && Number.isFinite(id) ? { at, id } : undefined;
    const query = {
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(before === undefined ? {} : { before }),
      ...(url.searchParams.get("actor") ? { actor: url.searchParams.get("actor") ?? "" } : {}),
      ...(url.searchParams.get("action") ? { action: url.searchParams.get("action") ?? "" } : {}),
    };
    try {
      const entries = await audit().recent(query);
      sendJson(response, 200, {
        ok: true,
        entries,
        // The watermark for the next page, or null when this page was the last one.
        next:
          entries.length === 0
            ? null
            : { beforeAt: entries.at(-1)?.at ?? 0, beforeId: entries.at(-1)?.id ?? 0 },
      });
    } catch (error) {
      logger.error("the activity trail did not read", { error: messageOf(error) });
      refuse(response, 500, "activity-unavailable", "the activity trail could not be read");
    }
  };

  /**
   * Sends one message with the mail transport this deployment would actually use.
   *
   * The transport is built from the panel's saved rows laid over the environment, which
   * is the same composition the auth service boots with, so an operator who fixes an SMTP
   * password in the panel can prove it here instead of waiting for a sign-up to fail.
   * `console` is answered as a success with its name in the reply, because it *did* hand
   * the message to the log and saying otherwise would send the reader hunting for a bug.
   */
  const sendTestMail = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJsonBody(request, MAX_TEMPLATE_BODY_BYTES).catch(() => null);
    const parsed = body?.isOk() === true ? (body.value as { to?: unknown }) : null;
    const to = typeof parsed?.to === "string" ? parsed.to.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(to)) {
      refuse(response, 400, "invalid-body", "expected { to } to be an email address");
      return;
    }

    const rows = await readStoredSettings((env[DATABASE_URL_VARIABLE] ?? "").trim()).catch(
      () => [],
    );
    const configured = envWithSettings({ env, rows });
    const kind = configured.SUITE_MAIL_TRANSPORT?.trim() || "console";

    try {
      const transport = mailTransportFromEnv(configured, {
        write: (line) => logger.info("test mail", { line }),
      });
      await transport.send({
        to,
        subject: "Suite: test message",
        text: [
          "This is a test message from the Suite operator panel.",
          "",
          `The transport that carried it is ${kind}.`,
          "Nothing is wrong: no account was created and no link is inside.",
        ].join("\n"),
      });
    } catch (error) {
      const actor = (await sessionReader()?.(headersOf(request)))?.userId ?? "operator";
      await record(actor, {
        action: "mail.test",
        target: to,
        outcome: "failed",
        details: { transport: kind, error: messageOf(error) },
      });
      logger.error("the test message did not send", {
        transport: kind,
        error: messageOf(error),
      });
      refuse(response, 502, "mail-failed", messageOf(error));
      return;
    }

    const actor = (await sessionReader()?.(headersOf(request)))?.userId ?? "operator";
    await record(actor, {
      action: "mail.test",
      target: to,
      outcome: "ok",
      details: { transport: kind },
    });
    logger.info("test message sent", { transport: kind, to });
    sendJson(response, 200, { ok: true, transport: kind });
  };

  /**
   * Test or live, read from the panel's row over the environment.
   *
   * The same composition billing itself boots with, so the dashboard a row links to is the
   * dashboard the row came from.
   */
  const subscriptionsMode = async (): Promise<"test" | "live"> => {
    const rows = await readStoredSettings((env[DATABASE_URL_VARIABLE] ?? "").trim()).catch(
      () => [],
    );
    return stripeMode(envWithSettings({ env, rows }));
  };

  /**
   * The paid half of the deployment.
   *
   * Read-only on purpose: cancelling somebody's plan from an operator surface is a billing
   * write with a person's money behind it, and it deserves its own decision rather than a
   * second button here. Missing table reads as an empty list, because a deployment with
   * billing off has no subscription table at all and that is not an error.
   */
  const listSubscriptions = async (response: ServerResponse) => {
    try {
      const result = await database().query(SUBSCRIPTIONS_SQL);
      sendJson(response, 200, {
        ok: true,
        // Which pair of Stripe credentials is active, so the panel can deep-link into the
        // matching dashboard. A test-mode link to a live subscription opens nothing.
        mode: await subscriptionsMode(),
        subscriptions: (result.rows as SubscriptionRow[]).map((row) => ({
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          plan: row.plan,
          status: row.status,
          periodEnd: millisOf(row.periodEnd),
          cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
          seats: row.seats === null ? null : Number(row.seats),
          stripeCustomerId: row.stripeCustomerId,
          stripeSubscriptionId: row.stripeSubscriptionId,
        })),
      });
    } catch (error) {
      // A missing table is "billing has never run here", not a failure to report.
      if (/does not exist|no such table|undefined table/iu.test(messageOf(error))) {
        sendJson(response, 200, { ok: true, subscriptions: [] });
        return;
      }
      logger.error("the subscription list did not read", { error: messageOf(error) });
      refuse(response, 500, "subscriptions-unavailable", "the subscription list could not be read");
    }
  };

  return {
    name: "admin",
    async handle(request, response): Promise<boolean> {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;

      if (path === SUBSCRIPTIONS_PATH) {
        if (!(await operatorGate(request, response))) return true;
        if (!storageGate(response)) return true;
        if (methodOf(request) !== "GET") {
          methodNotAllowed(response, "GET", methodOf(request));
          return true;
        }
        await listSubscriptions(response);
        return true;
      }

      if (path === ACTIVITY_PATH) {
        if (!(await operatorGate(request, response))) return true;
        if (!storageGate(response)) return true;
        if (methodOf(request) !== "GET") {
          methodNotAllowed(response, "GET", methodOf(request));
          return true;
        }
        await listActivity(request, response);
        return true;
      }

      if (path === MAIL_TEST_PATH) {
        if (!(await operatorGate(request, response))) return true;
        if (!storageGate(response)) return true;
        if (methodOf(request) !== "POST") {
          methodNotAllowed(response, "POST", methodOf(request));
          return true;
        }
        await sendTestMail(request, response);
        return true;
      }

      if (path === ADMISSIONS_PATH) {
        await admissionsHandler(request, response);
        return true;
      }

      if (path === TEMPLATES_PATH) {
        return await templatesHandler.handlePublicTemplates(request, response);
      }

      const isAccounts = path === ACCOUNTS_PATH || path.startsWith(`${ACCOUNTS_PATH}/`);
      if (isAccounts) {
        if (!(await operatorGate(request, response))) return true;
        if (!storageGate(response)) return true;
        const method = methodOf(request);
        if (path === ACCOUNTS_PATH) {
          if (method === "GET") await listAccounts(request, response);
          else methodNotAllowed(response, "GET", method);
          return true;
        }
        const id = supportAccessId(path, response);
        if (id === undefined) return true;
        if (id === null) return false;
        if (method === "PUT") await revokeSupportAccess(request, response, id);
        else methodNotAllowed(response, "PUT", method);
        return true;
      }

      return await templatesHandler.handleAdminTemplates(path, request, response);
    },
  };
}

/** The mounted module. */
export const module: RouteModule = createAdminModule({
  env: process.env,
  logger: createLogger(),
});
