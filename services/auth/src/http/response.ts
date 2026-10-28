import type { Result } from "neverthrow";
import { type AuthErrorCode, isAuthError } from "./errors.js";

/**
 * The wire contract, in one place: what a route answers, and the only function that
 * turns a refusal into a response.
 *
 * Refusals are values here rather than exceptions. The domain modules still raise
 * `AuthError` for their own invariants, so `refusalOf` is the single seam that
 * converts a thrown value back into the same vocabulary — which is why there is one
 * `catch` in the whole HTTP layer instead of one per route.
 */

/** API Gateway (REST or HTTP API) proxy event, narrowed to what this service reads. */
export interface AuthHttpEvent {
  httpMethod?: string | null;
  path?: string | null;
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  isBase64Encoded?: boolean;
}

export interface AuthHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Everything a route may refuse with.
 *
 * `AuthError` satisfies this shape as it stands, so a named refusal carries its own
 * code straight through. `unexpected` is the answer for a fault we did not model — a
 * repository that threw, or an invitation engine outage — and it is deliberately not
 * a member of `authErrorCodes`: no route can *decide* to refuse that way.
 */
export interface HandlerRefusal {
  readonly code: AuthErrorCode | "unexpected";
  readonly message: string;
}

/** A route's answer: the response to send, or the refusal to map. */
export type RouteResult = Result<AuthHttpResponse, HandlerRefusal>;

const JSON_HEADERS = { "content-type": "application/json" };

const UNEXPECTED: HandlerRefusal = {
  code: "unexpected",
  message: "the control plane failed",
};

export function json(statusCode: number, body: Record<string, unknown>): AuthHttpResponse {
  return { statusCode, body: JSON.stringify(body), headers: JSON_HEADERS };
}

/** One place mapping a named error to a status, so the contract cannot drift per route. */
const STATUS_BY_CODE: Readonly<Record<HandlerRefusal["code"], number>> = {
  unauthorized: 401,
  forbidden: 403,
  "invalid-request": 400,
  "workspace-already-claimed": 409,
  "workspace-not-found": 404,
  "invite-not-found": 404,
  "invite-revoked": 409,
  "invite-expired": 409,
  "invite-exhausted": 409,
  "auth-not-configured": 503,
  "seat-refused": 403,
  // Payment required, not forbidden: the request was well formed and the account is real,
  // it just has no plan behind it yet.
  "plan-required": 402,
  "workspace-limit": 403,
  "rate-limited": 429,
  "method-not-allowed": 405,
  "not-found": 404,
  unexpected: 500,
};

/**
 * The one refusal → response mapping. `unexpected` carries no code of its own in the
 * body's vocabulary, so the body says exactly that, which is what the route already
 * did when a fault escaped as an exception.
 */
export function failure(refusal: HandlerRefusal): AuthHttpResponse {
  return json(STATUS_BY_CODE[refusal.code], {
    ok: false,
    error: refusal.code,
    message: refusal.message,
  });
}

/** A thrown value, as a refusal. Only an `AuthError` keeps its code and its sentence. */
export function refusalOf(error: unknown): HandlerRefusal {
  return isAuthError(error) ? error : UNEXPECTED;
}

/** The unexpected refusal itself, for a caller that has already logged the reason. */
export function unexpected(): HandlerRefusal {
  return UNEXPECTED;
}

export function methodNotAllowed(allowed: string): AuthHttpResponse {
  return {
    statusCode: 405,
    body: JSON.stringify({ ok: false, error: "method-not-allowed" }),
    headers: { ...JSON_HEADERS, allow: allowed },
  };
}

export function methodOf(event: AuthHttpEvent): string {
  return (event.httpMethod ?? "GET").toUpperCase();
}

export function pathOf(event: AuthHttpEvent): string {
  return (event.path ?? "").split("?")[0] ?? "";
}
