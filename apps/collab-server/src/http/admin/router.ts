import type { IncomingMessage, ServerResponse } from "node:http";
import { metrics as processMetrics } from "../../ops/metrics.js";
import { HttpError, toProblem } from "../errors.js";
import { clientAddress, createRateLimiter } from "../rateLimit.js";
import { bearerToken } from "../request.js";
import { applyCors, sendEmpty, sendJson, sendProblem } from "../respond.js";
import type { AdminRequestDeps } from "./deps.js";
import {
  type AdminAuditRow,
  auditLogger,
  beginAudit,
  decodeSegment,
  envLimit,
  requireMethod,
  writeAudit,
} from "./deps.js";
import { createFixtures, exportWorkspace } from "./fixtures.js";
import { deleteLicence, putLicence } from "./licence.js";
import { disconnectRoomSessions, roomsBody, sweepProjectionRooms } from "./rooms.js";
import { listWorkspaceShares, revokeOneShare, revokeWorkspaceShares } from "./shares.js";
import { limitsBody, sendLimits, sendMetrics, statusBody, updateLimits } from "./status.js";
import { adminConfigured, allows, resolveAdminCredential, scopeOfMethod } from "./tokens.js";
import { deleteWorkspaceData, listWorkspaces, workspaceDetail } from "./workspaces.js";

/**
 * The operator API router: `/metrics` and `/api/admin/*` behind an operator session.
 * It returns false when the path is not its own. Both routes only exist while a control
 * plane is configured to verify a session against: a server with no identity answers
 * 404, never 401. The session has to be signed by that control plane and has to carry
 * `operator: true`, and there is no unscoped path — `read` cannot mutate.
 */

export const ADMIN_API_PATH = "/api/admin";

/**
 * Prometheus scrape path. It sits beside `/api/admin/*` rather than under it
 * because a scraper is configured with one URL, but it is gated by exactly the
 * same token: unset means 404, a wrong token means 401.
 */
export const METRICS_PATH = "/metrics";

/** Largest page `/api/admin/workspaces` will return, whatever `limit` asks. */
export const DEFAULT_ADMIN_PER_MINUTE = 300;

/**
 * Upper bounds of one fixture run. They keep a reproduction call small enough
 * to stay a reproduction: a fixture larger than this is load testing, not a
 * bug report.
 */
export const adminLimiter = createRateLimiter(
  envLimit("SUITE_ADMIN_RATE_LIMIT", DEFAULT_ADMIN_PER_MINUTE),
  60_000,
);

/**
 * The verb an audit row should name, derived from method and path.
 *
 * A handler that calls `audit()` overwrites this with its own word. The
 * derivation exists for the rows no handler writes, such as a scope refusal, and
 * it names the real operation rather than guessing from the last path segment:
 * `POST /api/admin/rooms/sweep` is `sweep-rooms`, not `create-sweep`.
 */
function actionOf(method: string, pathname: string): string {
  if (pathname === METRICS_PATH) return "scrape-metrics";
  const [first = "", second = "", third = ""] = pathname
    .slice(ADMIN_API_PATH.length)
    .replace(/^\/+/, "")
    .split("/");
  if (method === "DELETE" && first === "shares") return "revoke-workspace-shares";
  if (method === "DELETE" && first === "workspaces") return "delete-workspace";
  if (method === "POST" && first === "shares" && third === "revoke") return "revoke-share";
  if (method === "POST" && first === "workspaces" && third === "export") return "export-workspace";
  if (method === "POST" && first === "rooms" && second === "sweep") return "sweep-rooms";
  if (method === "POST" && first === "rooms" && third === "disconnect") return "disconnect-room";
  if (method === "POST" && first === "fixtures") return "create-fixtures";
  if (method === "PUT" && first === "limits") return "update-limits";
  return `${method.toLowerCase()}-${first.length === 0 ? "admin" : first}`;
}

/** True for an address on this machine, which is where a scrape timer runs. */
function isLoopback(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

/** The id a mutation applied to: the first segment that looks like an id, else the route. */
function targetOf(pathname: string): string {
  const route = pathname.replace(METRICS_PATH, "metrics").slice(ADMIN_API_PATH.length);
  const parts = route.split("/").filter((part) => part.length > 0);
  // `workspaces`/`shares` name a collection; the id follows it.
  if ((parts[0] === "workspaces" || parts[0] === "shares") && parts.length > 1)
    return parts[1] ?? "";
  return parts[0] ?? "admin";
}

export async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const isMetrics = url.pathname === METRICS_PATH;
  if (
    !isMetrics &&
    url.pathname !== ADMIN_API_PATH &&
    !url.pathname.startsWith(`${ADMIN_API_PATH}/`)
  ) {
    return false;
  }

  applyCors(request, response);
  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    sendEmpty(response, 204);
    return true;
  }

  /**
   * A scrape from this machine with no credential, when the deployment says so.
   *
   * `/metrics` exists to be polled by a timer on the same box, and a timer cannot hold a
   * session: it has no browser and no cookie. `SUITE_METRICS_LOCAL=1` therefore allows an
   * *unauthenticated read of `/metrics` from a loopback address* and nothing else — not a
   * mutation, not another route, not a request that arrived through the proxy. The
   * default is off, so a deployment that never set the variable is exactly as closed as
   * before.
   */
  const localScrape =
    isMetrics &&
    method === "GET" &&
    (process.env.SUITE_METRICS_LOCAL ?? "").trim() === "1" &&
    isLoopback(clientAddress(request));

  if (localScrape) {
    sendMetrics(response, deps.metrics ?? processMetrics);
    return true;
  }

  // No control plane to verify a session against is a 404 (the feature is off).
  // Everything below answers, including a missing or wrong session: this handler never
  // rejects, so a caller's `.then` cannot be left waiting on a request it already refused.
  if (!adminConfigured()) return false;

  const needed = scopeOfMethod(method);
  let scopedDeps: AdminRequestDeps = deps;
  let row: AdminAuditRow | undefined;

  const run = async (): Promise<boolean> => {
    const budget = adminLimiter.take(clientAddress(request));
    if (!budget.ok) {
      throw HttpError.rateLimited(
        budget.retryAfter,
        "Too many admin requests. Wait a moment and try again.",
      );
    }

    const resolution = await resolveAdminCredential(bearerToken(request), deps.sessions);
    if (resolution.kind === "not-operator") {
      // Signed in, and not on the deployment's list. Recorded for a mutation like any
      // other refusal: an escalation attempt is worth a row.
      if (row !== undefined) row.result = "refused-scope";
      throw HttpError.forbidden("this account is not an operator on this deployment");
    }
    if (resolution.kind === "none") {
      throw HttpError.unauthorized("An operator session is required.");
    }
    const credential = resolution.credential;

    // One draft per mutating request. A refusal by scope is a mutation attempt,
    // so it gets a row too — an attempt to escalate is worth recording.
    if (needed === "mutate") {
      row = beginAudit(credential.actor);
      // A derived verb and target are the floor: a handler may replace both, but
      // no mutation reaches the log with an empty action, even one refused
      // before a handler ran.
      row.action = actionOf(method, url.pathname);
      row.target = targetOf(url.pathname);
      scopedDeps = { ...deps, actor: credential.actor, audit: row };
    } else {
      scopedDeps = { ...deps, actor: credential.actor };
    }

    if (!allows(credential, needed)) {
      if (row !== undefined) row.result = "refused-scope";
      throw HttpError.forbidden(
        `This session holds the ${credential.scopes.join(" and ")} scope; ${needed} is required.`,
      );
    }

    if (isMetrics) {
      requireMethod(response, method, "GET");
      sendMetrics(response, scopedDeps.metrics ?? processMetrics);
      return true;
    }

    const segment = url.pathname.slice(ADMIN_API_PATH.length).replace(/^\//, "");
    if (segment.length === 0) throw HttpError.notFound("Not found.");
    const parts = segment.split("/").map(decodeSegment);
    const [route = "", second, third] = parts;

    if (route === "status") {
      if (parts.length !== 1) throw HttpError.notFound("Not found.");
      requireMethod(response, method, "GET");
      sendJson(response, 200, statusBody(scopedDeps));
      return true;
    }

    if (route === "fixtures") {
      if (parts.length !== 1) throw HttpError.notFound("Not found.");
      requireMethod(response, method, "POST");
      await createFixtures(request, response, scopedDeps, url);
      return true;
    }

    if (route === "limits") {
      if (parts.length !== 1) throw HttpError.notFound("Not found.");
      requireMethod(response, method, "GET", "PUT");
      if (method === "PUT") {
        await updateLimits(request, response, scopedDeps, url);
        return true;
      }
      sendLimits(response, 200, limitsBody(scopedDeps));
      return true;
    }

    if (route === "rooms") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET");
        sendJson(response, 200, roomsBody(scopedDeps));
        return true;
      }
      if (parts.length === 2 && second === "sweep") {
        requireMethod(response, method, "POST");
        await sweepProjectionRooms(request, response, scopedDeps, url);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "disconnect") {
        requireMethod(response, method, "POST");
        disconnectRoomSessions(response, scopedDeps, second, url);
        return true;
      }
      throw HttpError.notFound("Not found.");
    }

    if (route === "shares") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET", "DELETE");
        if (method === "DELETE") {
          revokeWorkspaceShares(response, scopedDeps, url);
          return true;
        }
        listWorkspaceShares(response, scopedDeps, url);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "revoke") {
        requireMethod(response, method, "POST");
        revokeOneShare(response, scopedDeps, second, url);
        return true;
      }
      throw HttpError.notFound("Not found.");
    }

    if (route === "workspaces") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET");
        listWorkspaces(response, scopedDeps, url);
        return true;
      }
      if (parts.length === 2 && second?.length) {
        requireMethod(response, method, "GET", "DELETE");
        if (method === "DELETE") {
          await deleteWorkspaceData(request, response, scopedDeps, second, url);
          return true;
        }
        workspaceDetail(response, scopedDeps, second);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "export") {
        requireMethod(response, method, "GET");
        exportWorkspace(response, scopedDeps, second);
        return true;
      }
      // The licence row the quota gate reads, writable so a plan state is testable without
      // a payment provider.
      if (parts.length === 3 && second?.length && third === "licence") {
        requireMethod(response, method, "PUT", "DELETE");
        if (method === "DELETE") deleteLicence(response, scopedDeps, second);
        else await putLicence(request, response, scopedDeps, second);
        return true;
      }
      throw HttpError.notFound("Not found.");
    }

    throw HttpError.notFound("Not found.");
  };

  try {
    const handled = await run();
    if (row !== undefined) writeAudit(scopedDeps, row, url.pathname);
    return handled;
  } catch (error) {
    if (row !== undefined) {
      // The handler did not get to finish: 4xx is a refusal, 5xx a failure, and
      // the row says which without repeating an error message.
      const status = error instanceof HttpError ? error.status : 500;
      if (row.result === "ok") row.result = status < 500 ? "refused" : "failed";
      writeAudit(scopedDeps, row, url.pathname);
    }
    if (response.headersSent) return true;
    const problem = toProblem(error);
    if (problem) {
      sendProblem(response, problem);
      return true;
    }
    (deps.logger ?? auditLogger).error("request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 500, { error: "The admin request failed." });
    return true;
  }
}
