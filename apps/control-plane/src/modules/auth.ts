import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type AuthEntry,
  type AuthEnvironment,
  type AuthHttpEvent,
  authEnabled,
  authEnvironment,
  createAuthHandler,
  createMigratedAuthEntry,
  mailSenders,
  mailTransportFromEnv,
  type WorkspaceDataErasure,
  type WorkspaceDataStore,
} from "@suite/auth";
import { envWithSettings, resolveSetting } from "@suite/settings";
import { Pool } from "pg";
import { createLogger, type Logger } from "../logging.js";
import type { RouteModule } from "../routes.js";
import { composeBilling } from "./auth-billing.js";
import { publishSessionReader, sessionReader } from "./context.js";
import { createGrantStore, type GrantStore } from "./grants.js";
import { readStoredSettings } from "./settings.js";

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
 * ## What the erase can reach
 *
 * `DELETE /api/account` owns the account's Postgres rows and nothing on disk. The
 * relay holds the documents, share rows and attachment bytes, so `relayWorkspaceData`
 * builds the port `@suite/auth` asks for from `SUITE_RELAY_URL` and
 * `SUITE_RELAY_PURGE_TOKEN`, and the erase reports `removed` with the counts the relay
 * answered. Without those two variables the three relay stores report `not-configured`
 * with the command that finishes each workspace, which is the honest answer for a
 * deployment with no relay to call.
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
  // Support access and impersonation, which are ours: the plugin owns the mechanism and
  // this module owns the consent gate, the flag and the audit line.
  "/api/account/support-access",
  "/api/account/impersonate",
  "/api/account/stop-impersonating",
  "/api/workspaces/claim",
  "/api/invites/redeem",
  "/api/account",
  "/api/account/export",
  "/api/account/workspaces",
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
  /**
   * The support-grant store. The default opens a pool on the auth database; a test passes
   * a memory store so the consent gate is exercised without a server.
   */
  grants?: GrantStore;
  /** Writes the plugin's `admin` role for an operator. A test passes a spy. */
  operatorRoles?: (userId: string) => Promise<void>;
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
  const boot = options.boot ?? defaultBoot(logger, source);
  const enabled = authEnabled(env);

  /**
   * The support grants, and the flag that says whether impersonation exists at all.
   *
   * The flag is a settings row an operator can turn off, read from the environment the boot
   * composed: with it off, the route refuses before it looks at a grant, so a deployment
   * that never wants this can say so once.
   */
  const authDatabaseUrl =
    env.SUITE_AUTH_DATABASE_URL ?? source.SUITE_CONTROL_PLANE_DATABASE_URL ?? "";

  let authPool: Pool | null = null;
  const database = (): Pool => {
    authPool ??= new Pool({ connectionString: authDatabaseUrl, max: 2 });
    return authPool;
  };

  let store: GrantStore | null = options.grants ?? null;
  const grants = (): GrantStore => {
    store ??= createGrantStore(database());
    return store;
  };

  /**
   * Gives an operator-by-address the role the plugin's own gate reads.
   *
   * `SUITE_ADMIN_EMAILS` is this deployment's list, and the panel, the admissions queue
   * and the template list all answer to it. The admin plugin has its own gate, `role =
   * "admin"`, and it refuses `impersonate-user` for anything else. One account can be an
   * operator by the first definition and not the second, so the role is written here, for
   * an account already judged an operator by address: no account gains a capability from
   * this that `SUITE_ADMIN_EMAILS` had not already given it.
   */
  const operatorRoles =
    options.operatorRoles ??
    (async (userId: string): Promise<void> => {
      await database().query(`UPDATE "user" SET role = 'admin' WHERE id = $1 AND role <> 'admin'`, [
        userId,
      ]);
    });
  /**
   * Whether impersonation exists on this deployment, from the settings row.
   *
   * The row is read per request so an operator turning it off takes effect without a
   * restart, and a failed read is "on": the flag is a refusal switch, and the grant is
   * still the consent either way. `flags.impersonation` defaults to on in the registry.
   */
  const impersonationFlag = async (): Promise<"on" | "off"> => {
    const rows = await readStoredSettings(
      env.SUITE_AUTH_DATABASE_URL ?? source.SUITE_CONTROL_PLANE_DATABASE_URL ?? "",
    ).catch(() => []);
    const resolved = resolveSetting({ key: "flags.impersonation", rows });
    return resolved === null || resolved.value !== false ? "on" : "off";
  };

  // One boot per process: the first request migrates and composes, every later one
  // reuses it. A failed boot clears the memo so the next request retries — a control
  // plane that started before Postgres came up should not stay broken.
  let booting: Promise<AuthEntry> | null = null;
  let http: ReturnType<typeof createAuthHandler> | null = null;

  function service(): Promise<AuthEntry> {
    booting ??= boot(env).then((entry) => {
      // Published here rather than in the default boot: the operator routes have to ask
      // this same instance who is calling, whichever boot a deployment passed in.
      publishSessionReader(entry.sessions.sessionFor);
      return entry;
    });
    booting = booting.catch((error: unknown) => {
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

  /**
   * The account's own view of its support grant.
   *
   * This is the whole consent surface: the account reads whether support access is on,
   * turns it on, and turns it off again. It never names an operator, so the permission is
   * "support may look while this is on", not a standing relationship with a person.
   */
  async function handleSupportAccess(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> {
    if (path !== "/api/account/support-access") return false;

    const cookies = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
    const session = await sessionReader()?.({ cookie: cookies });
    if (!session) {
      sendJson(response, 401, {
        ok: false,
        error: "unauthorized",
        message: "sign in to change your support access",
      });
      return true;
    }

    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
      sendJson(response, 405, { error: "method-not-allowed", requestId: requestIdOf(request) });
      return true;
    }
    if (method === "PUT") await grants().grant(session.userId);
    if (method === "DELETE") await grants().revoke(session.userId);

    const grant = await grants().get(session.userId);
    if (method !== "GET") {
      logger.info("support access changed", {
        account: session.userId,
        granted: method === "PUT",
      });
    }
    sendJson(response, 200, {
      ok: true,
      granted: grant !== null && grant.revokedAt === null,
      grantedAt: grant?.grantedAt ?? null,
      revokedAt: grant?.revokedAt ?? null,
    });
    return true;
  }

  /**
   * Impersonation, gated on consent this deployment actually holds.
   *
   * Three refusals, each a different fact: not signed in, not an operator, and no live
   * support grant from the account. The plugin's own endpoints do the work — they set the
   * target's session cookie and keep the operator's beside it — so the browser becomes the
   * account with no second identity system, and `stop-impersonating` puts it back.
   *
   * The grant is the consent, the audit line is the record, and the account is told: the
   * panel shows the banner and the grant row shows who allowed it and when.
   */
  async function handleImpersonation(
    request: IncomingMessage,
    response: ServerResponse,
    entry: AuthEntry,
    path: string,
  ): Promise<boolean> {
    const impersonate = path === "/api/account/impersonate";
    const stop = path === "/api/account/stop-impersonating";
    if (!impersonate && !stop) return false;
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method-not-allowed", requestId: requestIdOf(request) });
      return true;
    }

    const cookies = typeof request.headers.cookie === "string" ? request.headers.cookie : "";
    const session = await sessionReader()?.({ cookie: cookies });
    if (!session) {
      sendJson(response, 401, {
        ok: false,
        error: "unauthorized",
        message: "sign in to use the operator surface",
      });
      return true;
    }

    if (stop) {
      await relayCookies(
        await pluginCall(entry, "/api/auth/admin/stop-impersonating", cookies),
        response,
      );
      return true;
    }

    if (!session.operator) {
      sendJson(response, 403, {
        ok: false,
        error: "forbidden",
        message: "this account is not an operator on this deployment",
      });
      return true;
    }
    if ((await impersonationFlag()) !== "on") {
      sendJson(response, 403, {
        ok: false,
        error: "impersonation-off",
        message: "the flags.impersonation setting is off on this deployment",
      });
      return true;
    }

    const read = await bodyOf(request);
    if (!read.ok) {
      sendJson(response, 413, { error: "payload_too_large", requestId: requestIdOf(request) });
      return true;
    }
    // `bodyOf` hands back the raw text; a body that is not JSON is a caller error here,
    // not a refusal from the plugin.
    let body: { userId?: unknown } | null = null;
    try {
      body = read.body === null ? null : (JSON.parse(read.body) as { userId?: unknown });
    } catch {
      body = null;
    }
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (userId.length === 0) {
      sendJson(response, 400, { ok: false, error: "invalid-body", message: "expected { userId }" });
      return true;
    }
    if (userId === session.userId) {
      sendJson(response, 400, {
        ok: false,
        error: "self-impersonation",
        message: "you are already yourself",
      });
      return true;
    }

    const granted = await grants().active(userId);
    if (!granted) {
      sendJson(response, 403, {
        ok: false,
        error: "no-support-grant",
        message:
          "this account has not allowed support access; it has to turn that on from its own account settings",
      });
      return true;
    }

    // The plugin's gate is the role, not the address; see `operatorRoles`.
    await operatorRoles(session.userId);
    const answered = await pluginCall(entry, "/api/auth/admin/impersonate-user", cookies, {
      userId,
    });
    // The plugin answers a refusal as a body with a `code`, not a status: `mfa-
    // enrollment-required` is the common one, because an account that may manage people
    // needs a second factor before it may do anything else. Relaying that as a 200 would
    // tell the panel an impersonation started when it did not.
    const answeredText = await answered.text();
    const refusal = refusalOf(answeredText);
    if (refusal !== null) {
      logger.warn("operator impersonation refused", {
        actor: session.userId,
        target: userId,
        code: refusal.code,
      });
      sendJson(response, 403, {
        ok: false,
        error: refusal.code,
        message: refusal.message,
        ...(refusal.enrollAt === undefined ? {} : { enrollAt: refusal.enrollAt }),
      });
      return true;
    }

    logger.warn("operator impersonation started", { actor: session.userId, target: userId });
    await relayCookies(answered, response, answeredText);
    return true;
  }

  /**
   * One call to the plugin's own endpoint, as the browser would make it.
   *
   * The admin plugin publishes `impersonate-user` and `stop-impersonating` under
   * `/api/auth/admin/*`; calling them through the entry's handler means this module uses
   * the same path a client would, and the plugin stays the owner of the mechanism.
   */
  async function pluginCall(
    entry: AuthEntry,
    path: string,
    cookies: string,
    body?: unknown,
  ): Promise<Response> {
    const origin = (env.SUITE_AUTH_URL ?? "http://localhost").replace(/\/$/, "");
    return entry.handler(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: {
          origin,
          ...(cookies.length === 0 ? {} : { cookie: cookies }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  /**
   * Hands the browser the cookies the plugin set.
   *
   * `Set-Cookie` cannot be copied through a plain header map: the response needs every one
   * of them, in order, because impersonation deletes the operator's `session_token`, keeps
   * it as `admin_session` and sets the target's own.
   */
  async function relayCookies(
    answered: Response,
    response: ServerResponse,
    body: string | null = null,
  ): Promise<void> {
    const cookies = answered.headers.getSetCookie?.() ?? [];
    const text = body ?? (await answered.text());
    // `text` is read above so the caller can inspect it; this keeps one read.
    for (const cookie of cookies) response.appendHeader?.("set-cookie", cookie);
    if (typeof response.appendHeader !== "function") {
      response.setHeader("set-cookie", cookies);
    }
    response.writeHead(answered.status, { "content-type": "application/json" });
    response.end(text);
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
    /**
     * Boots the instance now, so the session reader other modules read exists before
     * anybody signs in. Exposed rather than inlined so the load below can await it.
     */
    warmUp: async (): Promise<void> => {
      if (!enabled) return;
      try {
        await service();
      } catch (error) {
        logger.error("the account service did not start", { error: messageOf(error) });
      }
    },
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
      else if (await handleSupportAccess(request, response, path)) return true;
      else if (await handleImpersonation(request, response, entry, path)) return true;
      else await handleAccount(request, response, entry);
      return true;
    },
  };
}

/**
 * The plugin's own refusal, when the body is one.
 *
 * Better Auth answers an endpoint-level refusal with a `code` and a `message` on a 200,
 * so a caller that only reads the status reports success for a thing that did not happen.
 */
function refusalOf(body: string): { code: string; message: string; enrollAt?: string } | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown; enrollAt?: unknown };
    if (typeof parsed.code !== "string" || parsed.code.length === 0) return null;
    return {
      code: parsed.code,
      message: typeof parsed.message === "string" ? parsed.message : parsed.code,
      ...(typeof parsed.enrollAt === "string" ? { enrollAt: parsed.enrollAt } : {}),
    };
  } catch {
    return null;
  }
}

/** The request id the host put on the header, when it is there. */
function requestIdOf(request: IncomingMessage): string | undefined {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : undefined;
}

/**
 * The relay's address and the credential the control plane presents to it.
 *
 * Two variables rather than the relay's operator token: the account service is
 * the process with an internet-facing sign-in surface and an account database,
 * and the operator's own authority would let a bug here reach every workspace's limits,
 * rooms and links. This credential opens exactly one relay operation — purge the
 * workspace named in the path — so a compromise of this process costs documents,
 * not the relay's whole operator surface. The relay reads the token under the
 * same name; the URL is this process's own.
 */
export const RELAY_URL_VARIABLE = "SUITE_RELAY_URL";
export const RELAY_PURGE_TOKEN_VARIABLE = "SUITE_RELAY_PURGE_TOKEN";

/**
 * A purge that has not answered by now has failed. The erase is a whole-account
 * request: waiting forever on one workspace holds the account open and, worse,
 * holds it open with some of its data already deleted. Ten seconds is long enough
 * for a relay deleting a large document on a slow disk.
 */
const PURGE_TIMEOUT_MS = 10_000;

/**
 * The relay's workspace delete, hard-coded here.
 *
 * `apps/collab-server` exports the same path, and this package deliberately does
 * not depend on the relay: the control plane is the half that must stay up when
 * the relay does not. A path is the whole coupling, and it is checked by
 * `pnpm db:verify`, which drives both halves against a real file store.
 */
const RELAY_PURGE_PATH = "/api/workspaces";

/** A count from the relay's answer, or zero for a field that is missing or not a number. */
function countOf(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The relay's per-workspace stores as an HTTP port, or `null` when this
 * deployment names no relay.
 *
 * `null` is not a failure: a self-host that mounts no relay has nothing to erase,
 * and the erase report says so for each of the three stores instead of pretending
 * a delete happened. `SUITE_RELAY_URL` and `SUITE_RELAY_PURGE_TOKEN` are one
 * switch: half a pair is a deployment that cannot purge, so it reads as absent
 * rather than as a port that fails every call.
 *
 * `erase` maps the relay's own counts — a workspace document plus its projected
 * share rooms are the document store, share rows plus their draft baselines are
 * the share store — so the report's three numbers mean what the report says they
 * mean. A response that is not `2xx` throws, which keeps the account whole: the
 * erase stops before its Postgres transaction and the caller retries.
 */
export function relayWorkspaceData(
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = fetch,
): WorkspaceDataStore | null {
  const base = (env[RELAY_URL_VARIABLE] ?? "").trim().replace(/\/+$/u, "");
  const token = (env[RELAY_PURGE_TOKEN_VARIABLE] ?? "").trim();
  if (base.length === 0 || token.length === 0) return null;
  // Checked now, at boot, rather than inside the one route that would discover it:
  // a malformed URL is an operator typo, and a startup error naming the variable
  // is cheaper to read than a failed erasure a month later.
  const url = new URL(base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${RELAY_URL_VARIABLE} must be an http or https URL, got "${url.protocol}//"`);
  }

  return {
    /**
     * Reading share rows is not part of this credential: the purge token may
     * delete a workspace's shares, not list them. The export catches this and
     * carries the reason on each workspace, which is the same shape it uses for a
     * deployment with no relay at all.
     */
    shares: async (workspaceId: string) => {
      throw new Error(
        `the relay exposes no service read for the share rows of ${workspaceId}; the purge credential may delete a workspace's shares, not read them`,
      );
    },
    erase: async (workspaceId: string): Promise<WorkspaceDataErasure> => {
      const response = await fetcher(
        `${url.origin}${url.pathname === "/" ? "" : url.pathname}${RELAY_PURGE_PATH}/${encodeURIComponent(workspaceId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          // The relay requires the id in the body of a delete, so a mangled URL
          // cannot purge the wrong workspace. Same shape as the account's own.
          body: JSON.stringify({ confirm: workspaceId }),
          signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 200);
        throw new Error(
          `the relay answered ${response.status}${detail.length === 0 ? "" : `: ${detail}`}`,
        );
      }
      const body: unknown = await response.json();
      const counts =
        typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {};
      return {
        // The workspace's own document rows and the share rooms projected from it.
        documents: countOf(counts, "documents") + countOf(counts, "projected"),
        // Share rows and the draft baseline each one may have.
        shares: countOf(counts, "shares") + countOf(counts, "baselines"),
        attachments: countOf(counts, "attachments"),
      };
    },
  };
}

/**
 * The deployment composition: migrate, then serve.
 *
 * Billing is composed here rather than imported by `@suite/auth`, which takes the
 * plugin and the entitlement reader as ports. The mail transport is chosen the same
 * way: the service names four senders and never decides how a message travels.
 */
function defaultBoot(logger: Logger, source: Readonly<Record<string, string | undefined>>) {
  return async (env: AuthEnvironment): Promise<AuthEntry> => {
    // The panel's saved values, laid over the process environment before anything reads it.
    // Billing and mail take their settings once, when their plugin and transport are built,
    // so this is the one moment a row can reach them; every other setting is read per
    // request and does not need the overlay.
    const rows = await readStoredSettings(
      source.SUITE_CONTROL_PLANE_DATABASE_URL?.trim() ??
        source.SUITE_AUTH_DATABASE_URL?.trim() ??
        "",
    );
    const configured = envWithSettings({ env: source, rows });
    // From `configured`, not `env`: `AuthEnvironment` is the auth whitelist, so Stripe's
    // variables are absent from it, and the panel's rows are not in the process at all.
    const billing = await composeBilling(configured, logger);
    // The relay is a second package's process, so this is the only place that
    // knows both: `@suite/auth` takes the port, and this composition builds it
    // from the two variables an operator set. Absent, the erase reports the three
    // relay stores as not configured, with the command that finishes them.
    const workspaceData = relayWorkspaceData(configured);
    const entry = await createMigratedAuthEntry(env, {
      ...mailSenders(
        mailTransportFromEnv(configured, {
          write: (line) => logger.info("auth mail", { line }),
        }),
      ),
      ...(billing === null
        ? {}
        : { entitlements: billing.entitlements, billingPlugin: billing.plugin }),
      ...(workspaceData === null ? {} : { workspaceData }),
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

/** The object `loadModules` mounts. The host calls its `warmUp` as it mounts it. */
export const module: RouteModule = createAuthModule();

/**
 * Boot once at load, not on the first `/api/auth/*` request.
 *
 * The operator routes read the session reader this module publishes, and a reader that
 * only appears after somebody signs in means the panel answers "the account module is not
 * running here" on a perfectly configured deployment — the panel's first call is to the
 * relay, not to a sign-in route, so the boot never happened. Booting here makes the reader
 * exist from the start; a boot that fails still leaves the memo clear, so the first request
 * retries and `/health` keeps reporting what it found.
 */
void module.warmUp?.();
