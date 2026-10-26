import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, type HttpProblem, httpStatus } from "./errors.js";

/**
 * Response-side middleware: CORS, JSON bodies and the one place an
 * `HttpProblem` becomes a status line plus headers.
 */

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, x-suite-owner, x-suite-attachment-id",
  // Adding a custom header in the app means adding it here too;
  // corsAllowlist.test.ts fails if the two lists drift apart.
  "access-control-max-age": "86400",
};

/**
 * Applies CORS before the route writes its response. The default is `*` for
 * local development; a deployment sets `SUITE_ALLOWED_ORIGINS` to its app
 * origin(s). Same-origin deployments need no CORS at all.
 *
 * The share session cookie makes the resolve a credentialed request. A browser
 * refuses `credentials: "include"` against `Access-Control-Allow-Origin: *`, so
 * a request that carries an `Origin` is answered with that origin echoed back
 * and `allow-credentials` set. Requests without an `Origin` (curl, tests, the
 * server's own calls) keep the plain wildcard.
 */
export function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  const configured = (process.env.SUITE_ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const wildcard = configured.includes("*");

  if (typeof origin !== "string" || origin.length === 0) {
    if (wildcard) response.setHeader("access-control-allow-origin", "*");
    return;
  }
  if (!wildcard && !configured.includes(origin)) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("vary", "origin");
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, CORS_HEADERS);
  response.end();
}

/**
 * The single error -> response mapping. A tagged problem carries the headers its
 * answer needs (`allow`, `retry-after`), so no handler sets them by hand.
 */
export function sendProblem(response: ServerResponse, problem: HttpProblem): void {
  if (problem.tag === "method-not-allowed" && problem.allow) {
    response.setHeader("allow", problem.allow);
  }
  if (problem.tag === "rate-limited") response.setHeader("retry-after", String(problem.retryAfter));
  sendJson(response, httpStatus(problem), { error: problem.message });
}

export function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.setHeader("allow", allow);
  throw HttpError.methodNotAllowed(allow);
}
