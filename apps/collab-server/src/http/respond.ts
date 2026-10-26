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

/** Origin shape an unset allowlist answers: a loopback dev server on any port. */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/u;

interface CorsPolicy {
  /** Normalised entries of `SUITE_ALLOWED_ORIGINS`. */
  origins: readonly string[];
  /** An explicit `*`: the operator asked for every origin. */
  anyOrigin: boolean;
  /** The variable holds nothing, which is the development default. */
  unset: boolean;
}

/**
 * One entry as the browser spells it. `config.ts` normalises the same variable at
 * boot; a default port or a trailing slash here would never equal an `Origin`
 * header, so the comparison would fail with no error anywhere.
 */
function normalizeOrigin(entry: string): string | null {
  if (entry === "*") return "*";
  try {
    return new URL(entry).origin;
  } catch {
    return null;
  }
}

function corsPolicy(): CorsPolicy {
  const raw = process.env.SUITE_ALLOWED_ORIGINS ?? "";
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(normalizeOrigin)
    .filter((value): value is string => value !== null);
  return { origins, anyOrigin: origins.includes("*"), unset: raw.trim().length === 0 };
}

function allows(policy: CorsPolicy, origin: string): boolean {
  if (policy.anyOrigin) return true;
  // An unset allowlist is the development default, and development crosses
  // ports (`:5173` to `:1235`). Loopback keeps that working; a public origin
  // needs an entry, because the session cookie makes these calls credentialed.
  if (policy.unset) return LOOPBACK_ORIGIN.test(origin);
  return policy.origins.includes(origin);
}

/**
 * Applies CORS before the route writes its response. `SUITE_ALLOWED_ORIGINS`
 * names the browser origins a deployment answers: unset allows loopback
 * development origins, a list allows exactly those, and `*` allows any origin.
 * Same-origin deployments need no CORS at all.
 *
 * The share session cookie makes the resolve a credentialed request. A browser
 * refuses `credentials: "include"` against `Access-Control-Allow-Origin: *`, so
 * an allowed request that carries an `Origin` is answered with that origin
 * echoed back and `allow-credentials` set. Requests without an `Origin` (curl,
 * tests, the server's own calls) keep the plain wildcard.
 */
export function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  const policy = corsPolicy();
  const open = policy.anyOrigin || policy.unset;

  if (typeof origin !== "string" || origin.length === 0) {
    if (open) response.setHeader("access-control-allow-origin", "*");
    return;
  }
  if (!allows(policy, origin)) return;
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
