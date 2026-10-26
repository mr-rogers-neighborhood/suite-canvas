import { BillingError } from "../errors.ts";
import { billingEnabled, billingStoreBackend } from "../handler/env.ts";
// Types only: the HTTP shapes are the handler's, and a type import is erased
// before Node runs the file, so `handler.ts` -> `checkout.ts` stays a one-way
// dependency at runtime.
import type { LambdaHttpEvent, LambdaHttpResponse } from "../handler/handler.ts";
import type { Logger } from "../handler/log.ts";
import {
  CHECKOUT_SESSIONS,
  PORTAL_SESSIONS,
  postStripeForm,
  type StripeFetch,
  stripeMode,
} from "./client.ts";
import { parseTierTable, type TierPlan, type TierTable } from "./tiers.ts";

/**
 * The front door: the two routes that let a surface *start* a payment.
 *
 * The webhook stays the only thing that mints a licence. This module only asks Stripe
 * for a url — a Checkout Session for a subscription, or a Billing Portal session for an
 * existing customer — which is why there is no Stripe SDK here either; the HTTP seam is
 * `client.ts`.
 *
 * Two rules come straight from ADR-0065 and are enforced here, not in prose: the front
 * door is closed whenever the webhook is (`SUITE_BILLING_ENABLED`), and a session
 * created on a non-durable store says so in its response.
 */

export const CHECKOUT_PATH = "/api/billing/checkout";
export const PORTAL_PATH = "/api/billing/portal";

/** The exact sentence the response carries; a surface can compare against it. */
export const NON_DURABLE_STORE = "billing store is not durable";

/**
 * Where a Checkout Session sends the browser back to. The canvas dev server, because
 * test mode — the only mode that should be on outside a real deployment — is driven
 * from a developer's own machine. A live deployment must set `SUITE_APP_ORIGIN`;
 * localhost there is a visibly broken redirect rather than a silently wrong one.
 */
export const DEFAULT_APP_ORIGIN = "http://localhost:5173";

/** Stripe caps a metadata value at 500 characters; this is well inside that. */
const MAX_ID_LENGTH = 128;

/** What the front door reads. The webhook's environment extends this. */
export interface FrontDoorEnvironment {
  SUITE_BILLING_ENABLED: string | undefined;
  SUITE_BILLING_STORE: string | undefined;
  STRIPE_PRICE_TIERS: string | undefined;
  /** Stripe's secret or restricted key (`sk_test_…`, `rk_live_…`). Never logged. */
  STRIPE_SECRET_KEY: string | undefined;
  SUITE_APP_ORIGIN: string | undefined;
}

export interface FrontDoorDeps {
  env: FrontDoorEnvironment;
  log: Logger;
  fetch: StripeFetch;
}

export type BillingRoute = (event: LambdaHttpEvent) => Promise<LambdaHttpResponse>;

function json(statusCode: number, body: Record<string, unknown>): LambdaHttpResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** API Gateway base64-encodes a body it could not read as UTF-8; restore it first. */
function bodyOf(event: LambdaHttpEvent): string | null {
  const body = event.body;
  if (typeof body !== "string" || body.length === 0) return null;
  return event.isBase64Encoded === true ? Buffer.from(body, "base64").toString("utf8") : body;
}

function requestOf(event: LambdaHttpEvent): Record<string, unknown> | null {
  const body = bodyOf(event);
  return body === null ? null : readJson(body);
}

/** A field that has to be a non-empty string; anything else is a caller error. */
function textField(request: Record<string, unknown>, name: string): string | null {
  const value = request[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * A front door is asked for a tier; the table and the webhook are keyed by
 * price. This is where the two meet. When two prices name one tier — monthly and
 * annual — the first in the table is sold, so list the default first.
 */
export function priceForTier(
  tiers: TierTable,
  tier: string,
): { priceId: string; plan: TierPlan } | null {
  for (const [priceId, plan] of tiers) {
    if (plan.tier === tier) return { priceId, plan };
  }
  return null;
}

/** The configured origin, or `null` when the variable is not a URL. */
function originOf(env: FrontDoorEnvironment): string | null {
  const raw = env.SUITE_APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Where the browser lands after checkout. `billing` is the flag the app reads to
 * say what happened and `organization` is whose licence changed; `workspace` is
 * only there to put the customer back where they were, and is omitted when the
 * payment was started from an organization-level surface. No secret rides a
 * query string.
 */
function appUrl(
  origin: string,
  organizationId: string,
  workspaceId: string | null,
  outcome: "success" | "cancelled",
): string {
  const url = new URL(origin);
  url.searchParams.set("billing", outcome);
  url.searchParams.set("organization", organizationId);
  if (workspaceId !== null) url.searchParams.set("workspace", workspaceId);
  return url.toString();
}

export interface CheckoutSessionRequest {
  /**
   * The billing subject. A subscription belongs to an organization — the tenant
   * that holds the members, the seats and the licence (ADR-0065) — so this, not
   * a workspace, is what Stripe records as the payer.
   */
  organizationId: string;
  /** Optional: only tells the browser where to land, and names the workspace in metadata. */
  workspaceId: string | null;
  priceId: string;
  tier: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * The form `/v1/checkout/sessions` expects. The field names *are* the contract,
 * so they are spelled once, here, and asserted in the tests:
 *
 *   mode=subscription          a subscription, not a one-off payment
 *   line_items[0][price]       the configured price
 *   line_items[0][quantity]    Stripe will not create a line without both
 *   client_reference_id        the organization, visible in the dashboard
 *   metadata[organizationId]   …and carried onto the session object
 *   metadata[workspaceId]      the workspace the payment was started from
 *   metadata[tier]             so support reads the tier that was sold
 *   metadata[price_id]         the webhook's tier lookup may see metadata only:
 *                              a session does not expand its line items unless
 *                              the endpoint asks it to
 */
export function checkoutSessionForm(request: CheckoutSessionRequest): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.append("line_items[0][price]", request.priceId);
  form.append("line_items[0][quantity]", "1");
  form.set("success_url", request.successUrl);
  form.set("cancel_url", request.cancelUrl);
  form.set("client_reference_id", request.organizationId);
  form.set("metadata[organizationId]", request.organizationId);
  // Omitted rather than blank: an empty metadata value is a key that exists and
  // says nothing, which reads as a broken workspace id in the dashboard.
  if (request.workspaceId !== null) form.set("metadata[workspaceId]", request.workspaceId);
  form.set("metadata[tier]", request.tier);
  form.set("metadata[price_id]", request.priceId);
  return form;
}

/** A Portal session returns to the app; the customer id is the whole request. */
export function portalSessionForm(customerId: string, returnUrl: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", returnUrl);
  return form;
}

/**
 * One line per container, not one per request: this is a deployment fact, and a
 * log that repeats it on every checkout is noise. Tests reset it so an earlier
 * test cannot absorb the line this one counts.
 */
let nonDurableWarningLogged = false;

export function resetFrontDoorWarnings(): void {
  nonDurableWarningLogged = false;
}

/**
 * The 200 answer, with the store's honesty attached.
 *
 * Real money needs the durable store — ADR-0065 item 7, beta gate A5 — so the
 * response says it instead of leaving it to a paragraph in docs/reference/billing.md: a
 * surface can refuse to present a live checkout on an in-process store, and a
 * test-mode one can proceed with the warning showing. Test mode is *not*
 * blocked: a duplicated test event costs nothing.
 */
function answered(env: FrontDoorEnvironment, log: Logger, url: string, mode: string) {
  const body: Record<string, unknown> = { ok: true, url, mode };
  if (billingStoreBackend(env) !== "postgres") {
    if (!nonDurableWarningLogged) {
      nonDurableWarningLogged = true;
      log("warn", NON_DURABLE_STORE, { code: "billing-store-not-durable", backend: "memory" });
    }
    body.warning = NON_DURABLE_STORE;
  }
  return json(200, body);
}

/** A 500 an operator can act on: the log names the cause, the body names the code. */
function failed(
  log: Logger,
  route: "checkout" | "portal",
  error: BillingError,
): LambdaHttpResponse {
  log("error", `${route} failed`, { code: error.code, problem: error.message });
  return json(500, { ok: false, error: `${route}-failed`, code: error.code });
}

/**
 * The guards both routes share, in the order they must run: the switch before
 * anything is read (a deployment that cannot charge says `billing-disabled`
 * rather than failing inside Stripe), the body before the key, and the key
 * before the call.
 */
function refuseDisabled(deps: FrontDoorDeps, route: "checkout" | "portal") {
  if (billingEnabled(deps.env)) return null;
  deps.log("warn", `${route} refused`, { code: "billing-disabled" });
  return json(503, { ok: false, error: "billing-disabled" });
}

function refuseMissingKey(deps: FrontDoorDeps, route: "checkout" | "portal") {
  const key = deps.env.STRIPE_SECRET_KEY?.trim();
  if (key) return { key, refusal: null };
  // Loud on purpose: a deployment that forgot the key is misconfigured, and a
  // quiet no-op or a fabricated url would hide it until a customer complained.
  deps.log("error", `${route} failed`, { code: "missing-secret-key" });
  return {
    key: null,
    refusal: json(500, { ok: false, error: `${route}-failed`, code: "missing-secret-key" }),
  };
}

export function createCheckoutRoute(deps: FrontDoorDeps): BillingRoute {
  return async function checkoutRoute(event) {
    const disabled = refuseDisabled(deps, "checkout");
    if (disabled !== null) return disabled;

    const request = requestOf(event);
    const organizationId = request === null ? null : textField(request, "organizationId");
    // Optional, and only ever a return address, so an organization-level surface
    // can start a checkout without pretending to be inside one workspace.
    const workspaceId = request === null ? null : textField(request, "workspaceId");
    const tier = request === null ? null : textField(request, "tier");
    if (
      request === null ||
      organizationId === null ||
      organizationId.length > MAX_ID_LENGTH ||
      (workspaceId !== null && workspaceId.length > MAX_ID_LENGTH) ||
      tier === null
    ) {
      deps.log("warn", "checkout rejected", { code: "invalid-request" });
      return json(400, { ok: false, error: "invalid-request" });
    }

    // The table is how a tier becomes a price. Without it there is nothing to sell,
    // and a 400 would blame the caller for the deployment's fault.
    const tiers = parseTierTable(deps.env.STRIPE_PRICE_TIERS);
    if (tiers.isErr()) return failed(deps.log, "checkout", tiers.error);

    const chosen = priceForTier(tiers.value, tier);
    if (chosen === null) {
      deps.log("warn", "checkout rejected", { code: "unknown-tier", tier: tier.slice(0, 64) });
      return json(400, { ok: false, error: "unknown-tier" });
    }

    const { key, refusal } = refuseMissingKey(deps, "checkout");
    if (refusal !== null) return refusal;

    const origin = originOf(deps.env);
    if (origin === null) {
      return failed(
        deps.log,
        "checkout",
        new BillingError("invalid-config", "SUITE_APP_ORIGIN is not a URL"),
      );
    }

    const created = await postStripeForm(
      deps.fetch,
      key,
      CHECKOUT_SESSIONS,
      checkoutSessionForm({
        organizationId,
        workspaceId,
        priceId: chosen.priceId,
        tier: chosen.plan.tier,
        successUrl: appUrl(origin, organizationId, workspaceId, "success"),
        cancelUrl: appUrl(origin, organizationId, workspaceId, "cancelled"),
      }),
    );
    if (created.isErr()) return failed(deps.log, "checkout", created.error);

    const mode = stripeMode(key);
    deps.log("info", "checkout session created", {
      organizationId,
      workspaceId,
      tier: chosen.plan.tier,
      priceId: chosen.priceId,
      mode,
    });
    return answered(deps.env, deps.log, created.value, mode);
  };
}

/**
 * Subscription management for a customer that already exists.
 *
 * It mints nothing, so it carries no durability warning: sending someone to
 * Stripe to cancel is safe on any store.
 */
export function createPortalRoute(deps: FrontDoorDeps): BillingRoute {
  return async function portalRoute(event) {
    const disabled = refuseDisabled(deps, "portal");
    if (disabled !== null) return disabled;

    const request = requestOf(event);
    const customerId = request === null ? null : textField(request, "customerId");
    if (customerId === null) {
      deps.log("warn", "portal rejected", { code: "invalid-request" });
      return json(400, { ok: false, error: "invalid-request" });
    }

    const { key, refusal } = refuseMissingKey(deps, "portal");
    if (refusal !== null) return refusal;

    const origin = originOf(deps.env);
    if (origin === null) {
      return failed(
        deps.log,
        "portal",
        new BillingError("invalid-config", "SUITE_APP_ORIGIN is not a URL"),
      );
    }

    const created = await postStripeForm(
      deps.fetch,
      key,
      PORTAL_SESSIONS,
      portalSessionForm(customerId, origin),
    );
    if (created.isErr()) return failed(deps.log, "portal", created.error);

    const mode = stripeMode(key);
    deps.log("info", "portal session created", { customerId, mode });
    return json(200, { ok: true, url: created.value, mode });
  };
}
