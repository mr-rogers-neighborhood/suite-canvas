import type { IncomingMessage, ServerResponse } from "node:http";
import { mailSenders, mailTransportFromEnv } from "@suite/auth";
import { readJsonBody, sendJson } from "@suite/billing";
import type { Pool } from "pg";
import { type Logger, REQUEST_ID_HEADER } from "../logging.js";

/** Where an admitted person is told to go. Defaults to the app origin for this deployment. */
export const APP_URL_VARIABLE = "SUITE_APP_URL";
export const ADMISSIONS_PATH = "/admin/admissions";

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

export interface AdminAdmissionsContext {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  database: () => Pick<Pool, "query">;
  operatorGate: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  storageGate: (response: ServerResponse) => boolean;
  refuse: (response: ServerResponse, status: number, error: string, message: string) => void;
  methodNotAllowed: (response: ServerResponse, allowed: string, method: string) => void;
}

export function createAdmissionsHandler(ctx: AdminAdmissionsContext) {
  const { env, logger, database, operatorGate, storageGate, refuse, methodNotAllowed } = ctx;

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

  return async function handleAdmissions(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!(await operatorGate(request, response))) return;
    if (!storageGate(response)) return;

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
        error: error instanceof Error ? error.message : String(error),
        ...(typeof requestId === "string" ? { requestId } : {}),
      });
      refuse(response, 500, "admin-failed", "the queue could not be written");
    }
  };
}
