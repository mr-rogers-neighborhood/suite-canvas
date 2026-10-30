import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "@suite/billing";
import type { Pool } from "pg";
import { type Logger, REQUEST_ID_HEADER } from "../logging.js";

/** The launcher's list, readable without a token. */
export const TEMPLATES_PATH = "/api/templates";
/** The same list, plus writing, behind the token. One template is `/admin/templates/:id`. */
export const ADMIN_TEMPLATES_PATH = "/admin/templates";

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
export const MAX_TEMPLATE_BODY_BYTES = 16 * 1024 * 1024;

/** How long the public list may be reused. A minute of staleness is invisible next to a launch. */
export const TEMPLATE_LIST_CACHE = "public, max-age=60";

/** "relation does not exist": `0010_templates.sql` has not been applied to this database. */
const MISSING_TABLE = "42P01";

export const MISSING_TEMPLATES_TABLE =
  "the templates table does not exist in this database yet: apply services/auth/sql/0010_templates.sql (the migration runner does it at boot unless SUITE_AUTH_MIGRATE is off)";

function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === MISSING_TABLE
  );
}

/** A template row as the routes exchange it: `updated_at` is bookkeeping, not contract. */
export interface TemplateBody {
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
 */
export function templateFromBody(
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
 */
export function sendTemplateList(
  response: ServerResponse,
  templates: unknown,
  cacheable: boolean,
): void {
  const text = JSON.stringify({ ok: true, templates });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": cacheable ? TEMPLATE_LIST_CACHE : "no-store",
  });
  response.end(text);
}

export interface AdminTemplatesContext {
  logger: Logger;
  database: () => Pick<Pool, "query">;
  operatorGate: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  storageGate: (response: ServerResponse) => boolean;
  refuse: (response: ServerResponse, status: number, error: string, message: string) => void;
  methodNotAllowed: (response: ServerResponse, allowed: string, method: string) => void;
}

export function createTemplatesHandler(ctx: AdminTemplatesContext) {
  const { logger, database, operatorGate, storageGate, refuse, methodNotAllowed } = ctx;

  const templateFailure = (
    response: ServerResponse,
    request: IncomingMessage,
    what: string,
    error: unknown,
  ): void => {
    const requestId = request.headers[REQUEST_ID_HEADER];
    logger.error(what, {
      error: error instanceof Error ? error.message : String(error),
      ...(typeof requestId === "string" ? { requestId } : {}),
    });
    if (isMissingTable(error)) {
      refuse(response, 503, "templates-missing", MISSING_TEMPLATES_TABLE);
      return;
    }
    refuse(response, 500, "admin-failed", what);
  };

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

  const pathIdOf = (
    path: string,
    response: ServerResponse,
    base: string = ADMIN_TEMPLATES_PATH,
    noun = "template",
  ): string | null | undefined => {
    let id: string;
    try {
      id = decodeURIComponent(path.slice(base.length + 1));
    } catch {
      refuse(
        response,
        400,
        "invalid-request",
        `the ${noun} id in the path is not valid URL encoding`,
      );
      return undefined;
    }
    if (id.length === 0 || id.includes("/")) return null;
    return id;
  };

  return {
    handlePublicTemplates: async (
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<boolean> => {
      if (!storageGate(response)) return true;
      const method = (request.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        methodNotAllowed(response, "GET", method);
        return true;
      }
      await listTemplates(request, response, true);
      return true;
    },
    handleAdminTemplates: async (
      path: string,
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<boolean> => {
      const isCollection = path === ADMIN_TEMPLATES_PATH;
      const isItem = path.startsWith(`${ADMIN_TEMPLATES_PATH}/`);
      if (!isCollection && !isItem) return false;

      if (!(await operatorGate(request, response))) return true;
      if (!storageGate(response)) return true;

      const method = (request.method ?? "GET").toUpperCase();
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
