import { err } from "neverthrow";
import type { EnrollmentRedemption } from "../invitations/enrollment.js";
import type { LicenceStore, MembershipReader } from "../licensing/licences.js";
import type { WorkspaceRepository } from "../organizations/workspaces.js";
import type { AccountSession, AuthEnvironment } from "../types.js";
import {
  type AuthHttpEvent,
  type AuthHttpResponse,
  failure,
  type HandlerRefusal,
  methodOf,
  pathOf,
  type RouteResult,
  refusalOf,
} from "./response.js";
import { routeOf } from "./routes.js";

/**
 * The control-plane Lambda: one event in, one JSON response out.
 *
 * The routes live in `routes.ts` and the wire contract in `response.ts`; this module
 * owns the dependency surface a deployment injects and the single place a refusal
 * becomes a response. Its shape follows `services/billing/src/handler/handler.ts` on
 * purpose: named error codes in the body, and status codes that are the whole
 * contract.
 *
 * Nothing here can write a document. This service has no Loro dependency, no graph
 * dependency and no document store: the strongest version of "an invitation never
 * touches the document" is not being able to reach it.
 */

export interface AuthSessionReader {
  sessionFor: (headers: Record<string, string | undefined>) => Promise<AccountSession | null>;
}

export interface AuthHandlerDeps {
  env: AuthEnvironment;
  workspaces: WorkspaceRepository;
  licences: LicenceStore;
  memberships: MembershipReader;
  /**
   * Redemption, and the *only* way this service spends an invitation (ADR-0067 §10).
   *
   * It is a port rather than a repository because the write belongs to
   * `better-enrollment`: the plugin creates the account, sets the password, spends the
   * use and inserts the `member` row. Our route owns the contract in front of it — the
   * request shape, our error codes, and the refusal to be configured without it. Null
   * means "cannot redeem at all", which fails closed with `auth-not-configured`.
   */
  enrollment: { redeem: EnrollmentRedemption } | null;
  /** Null when the account service is off: every route then refuses as unconfigured. */
  sessions: AuthSessionReader | null;
  now?: () => number;
  log?: AuthLogger;
}

export type AuthLogger = (
  level: "info" | "warn" | "error",
  message: string,
  fields?: Record<string, unknown>,
) => void;

export type AuthHandler = (event: AuthHttpEvent) => Promise<AuthHttpResponse>;

export type { AuthHttpEvent, AuthHttpResponse, HandlerRefusal };

export function createAuthHandler(deps: AuthHandlerDeps): AuthHandler {
  const now = deps.now ?? Date.now;
  const log: AuthLogger = deps.log ?? (() => {});

  return async function authHandler(event) {
    const method = methodOf(event);
    const path = pathOf(event);

    // The only `catch` in the HTTP layer, and it is a safety net rather than a
    // branch: a repository that throws must still answer 500 with a named body
    // instead of surfacing as an opaque gateway error.
    let result: RouteResult;
    try {
      result = await routeOf(deps, event, now, log);
    } catch (error) {
      result = err(refusalOf(error));
    }

    if (result.isOk()) return result.value;

    const response = failure(result.error);
    const fields =
      result.error.code === "unexpected"
        ? { code: result.error.code, path, method, problem: result.error.message }
        : { code: result.error.code, path, method };
    log(response.statusCode >= 500 ? "error" : "warn", "control plane refused", fields);
    return response;
  };
}
