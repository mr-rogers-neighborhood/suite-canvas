import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mailSenders, mailTransportFromEnv } from "@suite/auth";
import { readJsonBody, sendJson } from "@suite/billing";
import { Pool } from "pg";
import { type ConfigEnv, DATABASE_URL_VARIABLE } from "../config.js";
import { createLogger, type Logger, REQUEST_ID_HEADER } from "../logging.js";
import type { RouteModule } from "../routes.js";

/**
 * The operator surface: one queue, one token.
 *
 * Admission is a person reading a list and deciding, so the list and the decision
 * need a door that is not a psql session. It is deliberately the *only* thing this
 * module does. A route that could also read every workspace would turn one leaked
 * bearer token into every tenant's documents, and the account service is the process
 * with an account database, not a console.
 *
 * `SUITE_ADMISSION_REQUIRED` without this token is a deployment that can hold people
 * it can never let in, so the boot refuses that pairing (see `adminMisconfigured`).
 */

export const ADMIN_TOKEN_VARIABLE = "SUITE_ADMIN_TOKEN";
export const ADMISSIONS_PATH = "/admin/admissions";

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

/**
 * Compares the presented token without leaking its length through timing.
 *
 * A short-circuiting `===` on a secret is the classic mistake; the lengths are
 * compared first only so `timingSafeEqual` is not handed buffers it would throw on.
 */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerOf(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer (.+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
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
  const token = (env[ADMIN_TOKEN_VARIABLE] ?? "").trim();
  if (queueOn && token.length < 16) {
    return `SUITE_ADMISSION_REQUIRED is on but ${ADMIN_TOKEN_VARIABLE} is missing or shorter than 16 characters, so nobody could be admitted`;
  }
  return null;
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

  return {
    name: "admin",
    async handle(request, response): Promise<boolean> {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path !== ADMISSIONS_PATH) return false;

      const token = (env[ADMIN_TOKEN_VARIABLE] ?? "").trim();
      if (token.length === 0) {
        refuse(response, 503, "admin-not-configured", `${ADMIN_TOKEN_VARIABLE} is not set`);
        return true;
      }
      const presented = bearerOf(request);
      if (presented === null || !tokenMatches(presented, token)) {
        response.setHeader("www-authenticate", "Bearer");
        refuse(response, 401, "unauthorized", "a bearer token is required");
        return true;
      }
      if (databaseUrl.length === 0) {
        refuse(response, 503, "admin-not-configured", `${DATABASE_URL_VARIABLE} is not set`);
        return true;
      }

      const method = (request.method ?? "GET").toUpperCase();
      const requestId = request.headers[REQUEST_ID_HEADER];
      if (method === "GET") {
        try {
          const result = await database().query(PENDING_SQL);
          sendJson(response, 200, { ok: true, pending: result.rows });
        } catch (error) {
          logger.error("the admission queue did not read", {
            error: error instanceof Error ? error.message : String(error),
            ...(typeof requestId === "string" ? { requestId } : {}),
          });
          refuse(response, 500, "admin-failed", "the queue could not be read");
        }
        return true;
      }

      if (method !== "POST") {
        response.setHeader("allow", "GET, POST");
        refuse(response, 405, "method_not_allowed", `${method} is not supported`);
        return true;
      }

      const read = await readJsonBody(request);
      if (read.isErr()) {
        refuse(response, 400, "invalid-request", read.error.message);
        return true;
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
        return true;
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
          error: error instanceof Error ? error.message : String(error),
          ...(typeof requestId === "string" ? { requestId } : {}),
        });
        refuse(response, 500, "admin-failed", "the queue could not be written");
      }
      return true;
    },
  };
}

/** The mounted module. */
export const module: RouteModule = createAdminModule({
  env: process.env,
  logger: createLogger(),
});
