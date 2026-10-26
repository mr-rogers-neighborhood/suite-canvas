import type { IncomingMessage, ServerResponse } from "node:http";
import { metrics as processMetrics } from "../../ops/metrics.js";
import { HttpError, toProblem } from "../errors.js";
import { clientAddress, createRateLimiter } from "../rateLimit.js";
import { bearerToken } from "../request.js";
import { applyCors, sendEmpty, sendJson, sendProblem } from "../respond.js";
import type { AdminRequestDeps } from "./deps.js";
import {
  adminToken,
  auditLogger,
  constantTimeEqual,
  decodeSegment,
  envLimit,
  requireMethod,
} from "./deps.js";
import { createFixtures, exportWorkspace } from "./fixtures.js";
import { disconnectRoomSessions, roomsBody, sweepProjectionRooms } from "./rooms.js";
import { listWorkspaceShares, revokeOneShare, revokeWorkspaceShares } from "./shares.js";
import { limitsBody, sendLimits, sendMetrics, statusBody, updateLimits } from "./status.js";
import {
  deleteWorkspaceData,
  listWorkspaces,
  resetWorkspaceOwner,
  workspaceDetail,
} from "./workspaces.js";

/**
 * The operator API router: `/metrics` and `/api/admin/*` behind one bearer
 * token. It returns false when the path is not its own. Both routes only exist
 * while `SUITE_ADMIN_TOKEN` is set: an unconfigured server answers 404, never
 * 401. There is no owner-key path to a mutation or to a scrape.
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

  const token = adminToken();
  if (token.length === 0) return false;

  applyCors(request, response);
  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    sendEmpty(response, 204);
    return true;
  }

  try {
    const budget = adminLimiter.take(clientAddress(request));
    if (!budget.ok) {
      throw HttpError.rateLimited(
        budget.retryAfter,
        "Too many admin requests. Wait a moment and try again.",
      );
    }

    const presented = bearerToken(request);
    if (presented === null || !constantTimeEqual(presented, token)) {
      throw HttpError.unauthorized("A valid admin token is required.");
    }

    if (isMetrics) {
      requireMethod(response, method, "GET");
      sendMetrics(response, deps.metrics ?? processMetrics);
      return true;
    }

    const segment = url.pathname.slice(ADMIN_API_PATH.length).replace(/^\//, "");
    if (segment.length === 0) throw HttpError.notFound("Not found.");
    const parts = segment.split("/").map(decodeSegment);
    const [route = "", second, third] = parts;

    if (route === "status") {
      if (parts.length !== 1) throw HttpError.notFound("Not found.");
      requireMethod(response, method, "GET");
      sendJson(response, 200, statusBody(deps));
      return true;
    }

    if (route === "fixtures") {
      if (parts.length !== 1) throw HttpError.notFound("Not found.");
      requireMethod(response, method, "POST");
      await createFixtures(request, response, deps, url);
      return true;
    }

    if (route === "limits") {
      if (parts.length !== 1) throw HttpError.notFound("Not found.");
      requireMethod(response, method, "GET", "PUT");
      if (method === "PUT") {
        await updateLimits(request, response, deps, url);
        return true;
      }
      sendLimits(response, 200, limitsBody(deps));
      return true;
    }

    if (route === "rooms") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET");
        sendJson(response, 200, roomsBody(deps));
        return true;
      }
      if (parts.length === 2 && second === "sweep") {
        requireMethod(response, method, "POST");
        await sweepProjectionRooms(request, response, deps, url);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "disconnect") {
        requireMethod(response, method, "POST");
        disconnectRoomSessions(response, deps, second, url);
        return true;
      }
      throw HttpError.notFound("Not found.");
    }

    if (route === "shares") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET", "DELETE");
        if (method === "DELETE") {
          revokeWorkspaceShares(response, deps, url);
          return true;
        }
        listWorkspaceShares(response, deps, url);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "revoke") {
        requireMethod(response, method, "POST");
        revokeOneShare(response, deps, second, url);
        return true;
      }
      throw HttpError.notFound("Not found.");
    }

    if (route === "workspaces") {
      if (parts.length === 1) {
        requireMethod(response, method, "GET");
        listWorkspaces(response, deps, url);
        return true;
      }
      if (parts.length === 2 && second?.length) {
        requireMethod(response, method, "GET", "DELETE");
        if (method === "DELETE") {
          await deleteWorkspaceData(request, response, deps, second, url);
          return true;
        }
        workspaceDetail(response, deps, second);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "export") {
        requireMethod(response, method, "GET");
        exportWorkspace(response, deps, second);
        return true;
      }
      if (parts.length === 3 && second?.length && third === "reset-owner") {
        requireMethod(response, method, "POST");
        await resetWorkspaceOwner(request, response, deps, second, url);
        return true;
      }
      throw HttpError.notFound("Not found.");
    }

    throw HttpError.notFound("Not found.");
  } catch (error) {
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
  }

  return true;
}
