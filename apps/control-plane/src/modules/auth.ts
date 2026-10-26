import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AuthEntry,
  type AuthEnvironment,
  type AuthHttpEvent,
  authEnabled,
  authEnvironment,
  consoleTransport,
  createAuthHandler,
  createMigratedAuthEntry,
  mailSenders,
} from "@suite/auth";
import { createLogger, type Logger } from "../logging.js";
import type { RouteModule } from "../routes.js";
import { composeBilling } from "./auth-billing.js";

/**
 * The account module: the one file in this process that knows `@suite/auth` exists.
 *
 * `modules/index.ts` loads this dynamically, so the host keeps compiling and booting
 * with no auth service at all. Once this file is present the host mounts it under the
 * name `auth`, and `/health` reports it as mounted.
 *
 * ## What it answers
 *
 * | Path | Owner | Does |
 * | --- | --- | --- |
 * | `/api/auth/*` | Better Auth's own handler | sign-up, sign-in, magic link, passkeys, Google callback, two-factor, organizations and their invitations, `GET /api/auth/jwks`, `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session`, and the billing plugin's checkout, portal and webhook when one is mounted |
 * | `POST /api/workspaces/claim` | `createAuthHandler` | gives an anonymous workspace an owner; this is the account-side claim, not the relay's `/api/workspaces/:id/claim` |
 * | `POST /api/invites/redeem` | `createAuthHandler` | the organization invitation, in our error codes |
 * | `GET /api/workspaces/:id/members` | `createAuthHandler` | members and roles, never addresses |
 * | `GET /api/account/export` | `createAuthHandler` | everything the account owns, as one download |
 * | `DELETE /api/account` | `createAuthHandler` | the account and every store it owns, reported per store |
 *
 * Everything else is declined, so the next module is asked and the host answers 404.
 *
 * ## When it is not usable
 *
 * `SUITE_AUTH_ENABLED` off answers `503 auth-not-configured` on every path this module
 * owns, rather than declining: "the file is mounted but the service is switched off" is
 * a different fact from "no route here", and a deployment should be able to read which
 * one it has. A failed boot (a database that will not migrate) answers
 * `503 auth-unavailable` and retries on the next request, so a control plane that comes
 * up before Postgres is not permanently broken.
 */

/** Better Auth's mount, and the one prefix this module claims wholesale. */
const AUTH_PREFIX = "/api/auth";

/** The account-side routes that are ours rather than Better Auth's. */
const ACCOUNT_PATHS: readonly string[] = [
  "/api/workspaces/claim",
  "/api/invites/redeem",
  "/api/account",
  "/api/account/export",
];

/** `GET /api/workspaces/:id/members`. The relay's `:id/claim` deliberately does not match. */
const MEMBERS_PATH = /^\/api\/workspaces\/[^/]+\/members$/u;

/** A body larger than this is not a sign-in, a claim or an invitation. */
const MAX_BODY_BYTES = 1_048_576;

/** How the module is built, with the seams a test replaces. */
export interface AuthModuleOptions {
  /** Environment to read; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Boots the service. The default is `createMigratedAuthEntry` with the console mail
   * transport; a test passes a fake entry so nothing opens a socket.
   */
  boot?: (env: AuthEnvironment) => Promise<AuthEntry>;
  logger?: Logger;
}

function pathOf(target: string | undefined): string {
  if (target === undefined) return "/";
  const query = target.indexOf("?");
  return query === -1 ? target : target.slice(0, query);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The origin Better Auth should think the request arrived on. */
function originOf(env: AuthEnvironment, request: IncomingMessage): string {
  const configured = env.SUITE_AUTH_URL?.trim();
  if (configured !== undefined && configured.length > 0) return new URL(configured).origin;
  const host = request.headers.host ?? "localhost";
  return `http://${host}`;
}

/** Inbound headers as a `Headers`, dropping the array-valued ones Node allows. */
function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

/** Reads the body, refusing one that is not an auth payload. */
async function bodyOf(
  request: IncomingMessage,
): Promise<{ ok: true; body: string | null } | { ok: false }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) return { ok: false };
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return { ok: true, body: body.length === 0 ? null : body };
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** A `Response` from Better Auth, written onto the node response. */
async function writeResponse(response: ServerResponse, source: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  source.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") headers[name] = value;
  });
  // `set-cookie` is the one header that repeats; `forEach` joins it, which would
  // corrupt two cookies into one invalid value.
  const cookies = source.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;

  const bytes = Buffer.from(await source.arrayBuffer());
  response.writeHead(source.status, headers);
  response.end(bytes.byteLength === 0 ? undefined : bytes);
}

export function createAuthModule(options: AuthModuleOptions = {}): RouteModule {
  const source = options.env ?? process.env;
  // `config.ts` makes `SUITE_CONTROL_PLANE_DATABASE_URL` the one connection string this
  // process must have before it binds a socket, and the account service reads
  // `SUITE_AUTH_DATABASE_URL`. They are the same database (ADR-0070), so the host's
  // variable is the fallback rather than a second one an operator has to discover.
  const env = authEnvironment({
    ...source,
    SUITE_AUTH_DATABASE_URL:
      source.SUITE_AUTH_DATABASE_URL ?? source.SUITE_CONTROL_PLANE_DATABASE_URL,
  });
  const logger = options.logger ?? createLogger().child({ component: "auth-module" });
  const boot = options.boot ?? defaultBoot(logger);
  const enabled = authEnabled(env);

  // One boot per process: the first request migrates and composes, every later one
  // reuses it. A failed boot clears the memo so the next request retries — a control
  // plane that started before Postgres came up should not stay broken.
  let booting: Promise<AuthEntry> | null = null;
  let http: ReturnType<typeof createAuthHandler> | null = null;

  function service(): Promise<AuthEntry> {
    booting ??= boot(env).catch((error: unknown) => {
      booting = null;
      throw error;
    });
    return booting;
  }

  function handlerFor(entry: AuthEntry): ReturnType<typeof createAuthHandler> {
    http ??= createAuthHandler({
      env,
      workspaces: entry.repositories.workspaces,
      licences: entry.repositories.licences,
      memberships: entry.repositories.memberships,
      enrollment: { redeem: entry.redeem },
      sessions: entry.sessions,
      accounts: entry.repositories.account ?? null,
      workspaceData: entry.repositories.workspaceData ?? null,
      log: (level, message, fields) => {
        const write =
          level === "info" ? logger.info : level === "warn" ? logger.warn : logger.error;
        write(message, fields);
      },
    });
    return http;
  }

  async function handleAuth(
    request: IncomingMessage,
    response: ServerResponse,
    entry: AuthEntry,
  ): Promise<void> {
    const read = await bodyOf(request);
    if (!read.ok) {
      sendJson(response, 413, { error: "payload_too_large", requestId: requestIdOf(request) });
      return;
    }
    const method = (request.method ?? "GET").toUpperCase();
    const url = new URL(request.url ?? "/", originOf(env, request));
    const headers = headersOf(request);
    // A write with no body is still a write: Better Auth's endpoints expect a JSON
    // object, and an absent body reads as a malformed one. `{}` is the value a client
    // sends for "nothing to say".
    const writes = method !== "GET" && method !== "HEAD";
    const body = read.body ?? (writes ? "{}" : null);
    if (body !== null && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    // The body is the decoded string, so the inbound length and transfer encoding no
    // longer describe it; leaving them would truncate a multi-byte payload.
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    const outbound = new Request(url, {
      method,
      headers,
      ...(body === null ? {} : { body }),
      redirect: "manual",
    });
    await writeResponse(response, await entry.handler(outbound));
  }

  async function handleAccount(
    request: IncomingMessage,
    response: ServerResponse,
    entry: AuthEntry,
  ): Promise<void> {
    const read = await bodyOf(request);
    if (!read.ok) {
      sendJson(response, 413, { error: "payload_too_large", requestId: requestIdOf(request) });
      return;
    }
    const event: AuthHttpEvent = {
      httpMethod: request.method ?? "GET",
      path: pathOf(request.url),
      body: read.body,
      headers: {
        ...(typeof request.headers.cookie === "string" ? { cookie: request.headers.cookie } : {}),
        ...(typeof request.headers["x-request-id"] === "string"
          ? { "x-request-id": request.headers["x-request-id"] }
          : {}),
      },
    };
    const answer = await handlerFor(entry)(event);
    const headers: Record<string, string> = { ...answer.headers };
    const requestId = requestIdOf(request);
    if (requestId !== undefined) headers["x-request-id"] = requestId;
    response.writeHead(answer.statusCode, headers);
    response.end(answer.body);
  }

  return {
    name: "auth",
    async handle(request, response): Promise<boolean> {
      const path = pathOf(request.url);
      const ownsAuth = path === AUTH_PREFIX || path.startsWith(`${AUTH_PREFIX}/`);
      const ownsAccount = ACCOUNT_PATHS.includes(path) || MEMBERS_PATH.test(path);
      if (!ownsAuth && !ownsAccount) return false;

      if (!enabled) {
        sendJson(response, 503, {
          ok: false,
          error: "auth-not-configured",
          message: "SUITE_AUTH_ENABLED is not 1",
          requestId: requestIdOf(request),
        });
        return true;
      }

      let entry: AuthEntry;
      try {
        entry = await service();
      } catch (error) {
        logger.error("the account service did not start", { error: messageOf(error) });
        sendJson(response, 503, {
          ok: false,
          error: "auth-unavailable",
          message: "the account service did not start",
          requestId: requestIdOf(request),
        });
        return true;
      }

      if (ownsAuth) await handleAuth(request, response, entry);
      else await handleAccount(request, response, entry);
      return true;
    },
  };
}

/** The request id the host put on the header, when it is there. */
function requestIdOf(request: IncomingMessage): string | undefined {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : undefined;
}

/**
 * The deployment composition: migrate, then serve, with the console mail transport.
 *
 * `transferAnonymousWorkspaces` is deliberately absent: it needs an `AdoptionStore`
 * over `member` and `organization`, and no repository for it exists yet. An anonymous
 * account's organizations therefore stay with the anonymous user until that lands.
 *
 * Billing is composed here rather than imported by `@suite/auth`, which takes the
 * plugin and the entitlement reader as ports.
 */
function defaultBoot(logger: Logger) {
  return async (env: AuthEnvironment): Promise<AuthEntry> => {
    const billing = await composeBilling({ ...env }, logger);
    const entry = await createMigratedAuthEntry(env, {
      ...mailSenders(
        consoleTransport({
          write: (line) => logger.info("auth mail", { line }),
        }),
      ),
      ...(billing === null
        ? {}
        : { entitlements: billing.entitlements, billingPlugin: billing.plugin }),
    });
    if (billing === null) return entry;
    return {
      ...entry,
      close: async () => {
        await entry.close();
        await billing.close();
      },
    };
  };
}

/** The object `loadModules` mounts. */
export const module: RouteModule = createAuthModule();
