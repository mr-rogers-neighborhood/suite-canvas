import type { IncomingMessage, ServerResponse } from "node:http";
import { mailSenders, mailTransportFromEnv } from "@suite/auth";
import { readJsonBody, sendJson } from "@suite/billing";
import { Pool } from "pg";
import { type ConfigEnv, DATABASE_URL_VARIABLE } from "../config.js";
import { createLogger, type Logger, REQUEST_ID_HEADER } from "../logging.js";
import type { RouteModule } from "../routes.js";
import { sessionReader } from "./context.js";

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
export const ADMISSIONS_PATH = "/admin/admissions";

/** The launcher's list, readable without a token. */
export const TEMPLATES_PATH = "/api/templates";
/** The same list, plus writing, behind the token. One template is `/admin/templates/:id`. */
export const ADMIN_TEMPLATES_PATH = "/admin/templates";

/** Where an admitted person is told to go. Defaults to the app origin for this deployment. */
export const APP_URL_VARIABLE = "SUITE_APP_URL";

export interface AdminModuleOptions {
  env: ConfigEnv;
  logger: Logger;
  /** The pool is injectable so a test drives the SQL against a stub, not a server. */
  pool?: Pick<Pool, "query"> | undefined;
}

const PENDING_SQL = `
  SELECT email, name, "createdAt"
  FROM "user"
  WHERE "admittedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 200
`;

const ADMIT_SQL = `
  UPDATE "user"
  SET "admittedAt" = $1
  WHERE lower(email) = ANY($2::text[]) AND "admittedAt" IS NULL
  RETURNING email
`;

const LIST_TEMPLATES_SQL = `
  SELECT id, name, description, version, data
  FROM templates
  ORDER BY name ASC
`;

/**
 * `ON CONFLICT DO NOTHING` rather than a caught unique violation: "that id is taken"
 * is an ordinary answer to a create, so the statement says it and the empty result is
 * the whole detection.
 *
 * `COALESCE($4, 1)` is the column default written out, because a body that omits
 * `version` sends `null` here rather than leaving the column off the insert.
 */
const INSERT_TEMPLATE_SQL = `
  INSERT INTO templates (id, name, description, version, data)
  VALUES ($1, $2, $3, COALESCE($4, 1), $5::jsonb)
  ON CONFLICT (id) DO NOTHING
  RETURNING id, name, description, version, data
`;

/**
 * A replace overwrites the content and keeps the stored revision when the body omits
 * one: the caller sending new cards is not necessarily also saying "this is a new
 * version of the starter".
 */
const REPLACE_TEMPLATE_SQL = `
  UPDATE templates
  SET name = $2,
      description = $3,
      version = COALESCE($4, version),
      data = $5::jsonb,
      updated_at = now()
  WHERE id = $1
  RETURNING id, name, description, version, data
`;

const DELETE_TEMPLATE_SQL = `
  DELETE FROM templates
  WHERE id = $1
  RETURNING id
`;

/**
 * The largest template body accepted, and why it is not the billing default.
 *
 * `readJsonBody` defaults to 64 KiB because a billing request is a handful of ids. A
 * template is a whole board with its pictures carried inline as base64 — the shape
 * `@suite/graph` defines, where one picture may decode to 2 MiB and therefore weigh
 * about 2.7 MiB as JSON. Six of those plus card text and edges is what fits in 16 MiB,
 * which is enough for the starters we intend to ship and still a bound the process can
 * absorb: a request over it is refused before its body is buffered, so a mistake in a
 * client cannot become an out-of-memory. A template that needs more than this wants
 * fewer pictures or smaller ones, not a bigger number here.
 */
const MAX_TEMPLATE_BODY_BYTES = 16 * 1024 * 1024;

/** How long the public list may be reused. A minute of staleness is invisible next to a launch. */
const TEMPLATE_LIST_CACHE = "public, max-age=60";

/** "relation does not exist": `0010_templates.sql` has not been applied to this database. */
const MISSING_TABLE = "42P01";

const MISSING_TEMPLATES_TABLE =
  "the templates table does not exist in this database yet: apply services/auth/sql/0010_templates.sql (the migration runner does it at boot unless SUITE_AUTH_MIGRATE is off)";

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

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === MISSING_TABLE
  );
}

/** A template row as the routes exchange it: `updated_at` is bookkeeping, not contract. */
interface TemplateBody {
  id: string;
  name: string;
  description: string;
  /** `null` when the body names none, which each statement resolves for itself. */
  version: number | null;
  /** Left unvalidated on purpose: the shape belongs to the client that produced it. */
  data: Record<string, unknown>;
}

/**
 * The body, or the sentence explaining why it is not one.
 *
 * This is the server's whole opinion about a template: an id and a name to list it by,
 * a description to show under the name, and an object to hand back. What is *inside*
 * `data` is `@suite/graph`'s business, and checking it here would mean importing the
 * graph package into the account service, which is the one import this process must
 * not make — the template was already validated where it was captured.
 *
 * `expectedId` is the path on a replace: the id comes from there, and a body that
 * contradicts it is a client bug worth a refusal rather than a silent overwrite of a
 * different template.
 */
function templateFromBody(
  body: unknown,
  expectedId?: string,
): { template: TemplateBody; problem?: undefined } | { template?: undefined; problem: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { problem: "body needs to be a JSON object" };
  }
  const record = body as Record<string, unknown>;

  const bodyId = typeof record.id === "string" ? record.id.trim() : "";
  const id = expectedId ?? bodyId;
  if (id.length === 0) return { problem: "id is required and has to be a non-empty string" };
  if (expectedId !== undefined && bodyId.length > 0 && bodyId !== expectedId) {
    return { problem: `the body's id "${bodyId}" is not the id in the path` };
  }

  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0) return { problem: "name is required and has to be a non-empty string" };

  if (record.description !== undefined && typeof record.description !== "string") {
    return { problem: "description, when given, has to be a string" };
  }
  // Absent means empty rather than refused: the column is NOT NULL, and "no description"
  // is a legitimate template, not an invalid one.
  const description = typeof record.description === "string" ? record.description.trim() : "";

  const data = record.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { problem: "data is required and has to be a JSON object" };
  }

  const rawVersion = record.version;
  if (rawVersion !== undefined && rawVersion !== null) {
    if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1) {
      return { problem: "version, when given, has to be a whole number of 1 or more" };
    }
  }
  const version = typeof rawVersion === "number" ? rawVersion : null;

  return { template: { id, name, description, version, data: data as Record<string, unknown> } };
}

/**
 * Writes a template list, cacheable or not.
 *
 * `sendJson` always writes `no-store`, which is right for every other answer here —
 * each one is about a named person. The public list is the exception the cache header
 * exists for: the launcher keeps its own copy and asks again on the next launch, so a
 * thousand launchers opening at once cost one query a minute, and a minute of
 * staleness after an operator edits a starter costs nothing. The admin copy stays
 * uncached, so the operator who just wrote a template sees it.
 */
function sendTemplateList(response: ServerResponse, templates: unknown, cacheable: boolean): void {
  const text = JSON.stringify({ ok: true, templates });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": cacheable ? TEMPLATE_LIST_CACHE : "no-store",
  });
  response.end(text);
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
    if (pool === null) pool = new Pool({ connectionString: databaseUrl, max: 2 });
    return pool;
  };

  const refuse = (response: ServerResponse, status: number, error: string, message: string) => {
    sendJson(response, status, { ok: false, error, message });
  };

  const admittedEmail = async (emails: readonly string[]): Promise<void> => {
    const appUrl = (env[APP_URL_VARIABLE] ?? "").trim();
    if (appUrl.length === 0) {
      // The admission stands even when the notice cannot be sent: the account is
      // unlocked either way, and the operator's list is the record of it.
      logger.warn("an account was admitted with no app URL to tell it about", {
        count: emails.length,
        variable: APP_URL_VARIABLE,
      });
      return;
    }
    const senders = mailSenders(
      mailTransportFromEnv(env, {
        write: (line) => logger.info("auth mail", { line }),
      }),
    );
    for (const email of emails) {
      try {
        await senders.sendAdmissionGranted({ email, appUrl });
      } catch (error) {
        logger.error("the admission notice did not send", {
          email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

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

  /** The failure answer for a template query, with the missing-table case named rather than 500. */
  const templateFailure = (
    response: ServerResponse,
    request: IncomingMessage,
    what: string,
    error: unknown,
  ): void => {
    const requestId = request.headers[REQUEST_ID_HEADER];
    logger.error(what, {
      error: messageOf(error),
      ...(typeof requestId === "string" ? { requestId } : {}),
    });
    if (isMissingTable(error)) {
      // A database that has not run `0010` is a deployment fault an operator can fix,
      // so it answers with the file to apply instead of a bare 500 to go and grep for.
      refuse(response, 503, "templates-missing", MISSING_TEMPLATES_TABLE);
      return;
    }
    refuse(response, 500, "admin-failed", what);
  };

  const handleAdmissions = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (!(await operatorGate(request, response))) return;
    if (!storageGate(response)) return;

    const method = methodOf(request);
    const requestId = request.headers[REQUEST_ID_HEADER];
    if (method === "GET") {
      try {
        const result = await database().query(PENDING_SQL);
        sendJson(response, 200, { ok: true, pending: result.rows });
      } catch (error) {
        logger.error("the admission queue did not read", {
          error: messageOf(error),
          ...(typeof requestId === "string" ? { requestId } : {}),
        });
        refuse(response, 500, "admin-failed", "the queue could not be read");
      }
      return;
    }

    if (method !== "POST") {
      methodNotAllowed(response, "GET, POST", method);
      return;
    }

    const read = await readJsonBody(request);
    if (read.isErr()) {
      refuse(response, 400, "invalid-request", read.error.message);
      return;
    }
    const body = read.value;
    const emails =
      typeof body === "object" &&
      body !== null &&
      Array.isArray((body as { emails?: unknown }).emails)
        ? (body as { emails: unknown[] }).emails.filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
        : [];
    if (emails.length === 0) {
      refuse(response, 400, "invalid-request", "body needs a non-empty emails array");
      return;
    }

    try {
      const result = await database().query(ADMIT_SQL, [
        Date.now(),
        emails.map((email) => email.trim().toLowerCase()),
      ]);
      const admitted = result.rows.map((row: { email: string }) => row.email);
      if (admitted.length > 0) await admittedEmail(admitted);
      logger.info("accounts admitted", { count: admitted.length });
      sendJson(response, 200, { ok: true, admitted });
    } catch (error) {
      logger.error("the admission did not write", {
        error: messageOf(error),
        ...(typeof requestId === "string" ? { requestId } : {}),
      });
      refuse(response, 500, "admin-failed", "the queue could not be written");
    }
  };

  /** The list, from one statement, written through whichever cache policy the door has. */
  const listTemplates = async (
    request: IncomingMessage,
    response: ServerResponse,
    cacheable: boolean,
  ): Promise<void> => {
    try {
      const result = await database().query(LIST_TEMPLATES_SQL);
      sendTemplateList(response, result.rows, cacheable);
    } catch (error) {
      templateFailure(response, request, "the template list did not read", error);
    }
  };

  const createTemplate = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const read = await readJsonBody(request, MAX_TEMPLATE_BODY_BYTES);
    if (read.isErr()) {
      refuse(response, 400, "invalid-request", read.error.message);
      return;
    }
    const parsed = templateFromBody(read.value);
    if (parsed.template === undefined) {
      refuse(response, 400, "invalid-request", parsed.problem);
      return;
    }
    const { template } = parsed;
    try {
      const result = await database().query(INSERT_TEMPLATE_SQL, [
        template.id,
        template.name,
        template.description,
        template.version,
        JSON.stringify(template.data),
      ]);
      const stored = result.rows[0];
      if (stored === undefined) {
        refuse(
          response,
          409,
          "template-exists",
          `a template with id "${template.id}" already exists; PUT it to replace it`,
        );
        return;
      }
      logger.info("template created", { id: template.id });
      // 200 rather than 201, like every other answer here: the client reads `ok` and the
      // stored row, which is the same object a replace returns.
      sendJson(response, 200, { ok: true, template: stored });
    } catch (error) {
      templateFailure(response, request, "the template did not write", error);
    }
  };

  const replaceTemplate = async (
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ): Promise<void> => {
    const read = await readJsonBody(request, MAX_TEMPLATE_BODY_BYTES);
    if (read.isErr()) {
      refuse(response, 400, "invalid-request", read.error.message);
      return;
    }
    const parsed = templateFromBody(read.value, id);
    if (parsed.template === undefined) {
      refuse(response, 400, "invalid-request", parsed.problem);
      return;
    }
    const { template } = parsed;
    try {
      const result = await database().query(REPLACE_TEMPLATE_SQL, [
        template.id,
        template.name,
        template.description,
        template.version,
        JSON.stringify(template.data),
      ]);
      const stored = result.rows[0];
      if (stored === undefined) {
        refuse(response, 404, "template-not-found", `no template has the id "${id}"`);
        return;
      }
      logger.info("template replaced", { id });
      sendJson(response, 200, { ok: true, template: stored });
    } catch (error) {
      templateFailure(response, request, "the template did not write", error);
    }
  };

  const deleteTemplate = async (
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ): Promise<void> => {
    try {
      const result = await database().query(DELETE_TEMPLATE_SQL, [id]);
      if (result.rows.length === 0) {
        refuse(response, 404, "template-not-found", `no template has the id "${id}"`);
        return;
      }
      logger.info("template deleted", { id });
      sendJson(response, 200, { ok: true, deleted: true });
    } catch (error) {
      templateFailure(response, request, "the template did not delete", error);
    }
  };

  /**
   * The id a `/admin/templates/<id>` path names.
   *
   * A path one segment deeper, or an empty one, is not this module's route and says so
   * with `null`; a path whose percent-encoding does not decode is a caller error, so the
   * refusal is written here and `undefined` comes back.
   */
  const pathIdOf = (path: string, response: ServerResponse): string | null | undefined => {
    let id: string;
    try {
      id = decodeURIComponent(path.slice(ADMIN_TEMPLATES_PATH.length + 1));
    } catch {
      refuse(
        response,
        400,
        "invalid-request",
        "the template id in the path is not valid URL encoding",
      );
      return undefined;
    }
    if (id.length === 0 || id.includes("/")) return null;
    return id;
  };

  return {
    name: "admin",
    async handle(request, response): Promise<boolean> {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;

      if (path === ADMISSIONS_PATH) {
        await handleAdmissions(request, response);
        return true;
      }

      if (path === TEMPLATES_PATH) {
        // No token, deliberately: the launcher draws the starter gallery before anybody
        // signs in, and a token shipped in a client is not a token. What is exposed is
        // starter content, which is public the moment it is published.
        if (!storageGate(response)) return true;
        const method = methodOf(request);
        if (method !== "GET") {
          methodNotAllowed(response, "GET", method);
          return true;
        }
        await listTemplates(request, response, true);
        return true;
      }

      const isCollection = path === ADMIN_TEMPLATES_PATH;
      const isItem = path.startsWith(`${ADMIN_TEMPLATES_PATH}/`);
      if (!isCollection && !isItem) return false;

      if (!(await operatorGate(request, response))) return true;
      if (!storageGate(response)) return true;

      const method = methodOf(request);
      if (isCollection) {
        if (method === "GET") await listTemplates(request, response, false);
        else if (method === "POST") await createTemplate(request, response);
        else methodNotAllowed(response, "GET, POST", method);
        return true;
      }

      const id = pathIdOf(path, response);
      if (id === undefined) return true;
      if (id === null) return false;

      if (method === "PUT") await replaceTemplate(request, response, id);
      else if (method === "DELETE") await deleteTemplate(request, response, id);
      else methodNotAllowed(response, "PUT, DELETE", method);
      return true;
    },
  };
}

/** The mounted module. */
export const module: RouteModule = createAdminModule({
  env: process.env,
  logger: createLogger(),
});
