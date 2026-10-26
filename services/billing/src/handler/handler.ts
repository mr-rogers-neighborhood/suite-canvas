import { err, fromPromise, ok, type Result } from "neverthrow";
import { BillingError, type BillingFailure, billingFailureOf } from "../errors.ts";
import { billingStoreFor } from "../store/fromEnvironment.ts";
import type { BillingStore } from "../store/store.ts";
import {
  type BillingRoute,
  CHECKOUT_PATH,
  createCheckoutRoute,
  createPortalRoute,
  PORTAL_PATH,
} from "../stripe/checkout.ts";
import { globalFetch, type StripeFetch } from "../stripe/client.ts";
import { type Emailer, emailerFromEnvironment } from "../stripe/email.ts";
import {
  parseStripeEvent,
  readCheckoutSession,
  readInvoice,
  type StripeEvent,
  verifyStripeSignature,
} from "../stripe/events.ts";
import {
  type IssueOutcome,
  type Issuer,
  issueFromCheckout,
  issueFromInvoice,
} from "../stripe/issue.ts";
import { parseTierTable } from "../stripe/tiers.ts";
import {
  type BillingEnvironment,
  billingEnabled,
  billingStoreBackend,
  DEFAULT_SELF_HOST_URL,
  environment,
} from "./env.ts";
import { jsonLogger, type Logger } from "./log.ts";

/**
 * The Lambda entry point: one route for Stripe to call, two for a surface to
 * start a payment.
 *
 * The webhook — one HTTPS POST from Stripe in, one signed licence out — is the
 * only thing that mints. Its status codes are the whole retry protocol:
 *
 *   400  the request is not a Stripe event we can trust (bad signature, bad
 *        body). Retrying cannot help, so Stripe stops.
 *   200  handled, ignored on purpose, or already handled. Also stops retries.
 *   500  we failed at something that a retry can fix once the operator acts
 *        (unknown price, SES outage, missing key). Stripe retries, and the
 *        idempotency claim is released so the retry is not mistaken for a
 *        duplicate.
 *   503  hosted billing is switched off (`SUITE_BILLING_ENABLED` is not `1`),
 *        which is the alpha default. Nothing is verified, claimed, signed or
 *        sent; Stripe keeps retrying in case the function was deployed by
 *        mistake.
 *
 * The two front-door routes (`POST /api/billing/checkout`, `POST
 * /api/billing/portal`, see `stripe/checkout.ts`) answer the same 503 under the same
 * switch, and are answered before the store or the email transport is warmed: a
 * customer must be able to start a payment even when SES is misconfigured, and
 * a checkout must not load the SES SDK to find that out.
 *
 * **The processing step answers with a `Result`.** A paid event has exactly two
 * outcomes — an `IssueOutcome` or a `BillingError` — and the handler maps the second
 * through `failureOf` in one place, instead of an exception carrying it up through a
 * `catch`.
 *
 * Nothing in this file ever writes the token to the log.
 */

export type { BillingEnvironment };
export { billingEnabled, billingStoreBackend, environment };

/** API Gateway (REST or HTTP API) proxy event, narrowed to what we read. */
export interface LambdaHttpEvent {
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  isBase64Encoded?: boolean;
  /** HTTP API (payload v2) puts the request path here; REST API (v1) uses `path`. */
  rawPath?: string | null;
  path?: string | null;
}

export interface LambdaHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export interface HandlerDeps {
  store: BillingStore;
  emailer: Emailer;
  env: BillingEnvironment;
  now?: () => number;
  log?: Logger;
  /** Injected by the routing tests; a deployment uses the runtime's `fetch`. */
  stripeFetch?: StripeFetch;
}

export type BillingHandler = (event: LambdaHttpEvent) => Promise<LambdaHttpResponse>;

/** The one route Stripe calls; every other path belongs to the front door. */
export const WEBHOOK_PATH = "/stripe/webhook";

/**
 * API Gateway hands the path over as `rawPath` (HTTP API) or `path` (REST API).
 *
 * `null` means the request carries no path at all — every fixture in these
 * tests, and an invocation that is not an API Gateway proxy — which is the
 * webhook, because that is what this function was before it had a second route.
 * A path is never guessed from the body: a signed delivery posted to the
 * checkout route is a caller error, not a licence.
 */
export function pathOf(event: LambdaHttpEvent): string | null {
  const raw = typeof event.rawPath === "string" ? event.rawPath : event.path;
  const path = typeof raw === "string" ? raw.trim() : "";
  if (path.length === 0) return null;
  return path.replace(/\/+$/, "") || "/";
}

const HANDLED_EVENTS = new Set(["checkout.session.completed", "invoice.paid"]);

function json(statusCode: number, body: Record<string, unknown>): LambdaHttpResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

function headerOf(
  headers: Record<string, string | undefined> | null | undefined,
  name: string,
): string | null {
  if (headers === null || headers === undefined) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === "string") return value;
  }
  return null;
}

/**
 * The exact bytes Stripe signed. API Gateway base64-encodes a body it could
 * not decode as UTF-8, so it has to be restored before the HMAC is checked.
 */
function rawBodyOf(event: LambdaHttpEvent): string | Buffer | null {
  const body = event.body;
  if (typeof body !== "string" || body.length === 0) return null;
  return event.isBase64Encoded === true ? Buffer.from(body, "base64") : body;
}

/** Lambda env vars cannot hold a real newline; accept the escaped form. */
function privateKeyOf(env: BillingEnvironment): string {
  const raw = env.SUITE_LICENCE_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new BillingError("invalid-config", "SUITE_LICENCE_PRIVATE_KEY is not set");
  }
  return raw.includes("\\n") ? raw.replaceAll("\\n", "\n") : raw;
}

/** Everything an issuing function needs, or the reason it cannot run. */
function issuerFor(deps: HandlerDeps, now: () => number): Result<Issuer, BillingError> {
  const tiers = parseTierTable(deps.env.STRIPE_PRICE_TIERS);
  if (tiers.isErr()) return err(tiers.error);
  return ok({
    store: deps.store,
    tiers: tiers.value,
    emailer: deps.emailer,
    privateKeyPem: privateKeyOf(deps.env),
    selfHostUrl: deps.env.SUITE_SELF_HOST_URL?.trim() || DEFAULT_SELF_HOST_URL,
    now,
  });
}

/**
 * One event, one outcome or one failure.
 *
 * The issuing functions still throw their own `BillingError` for a price nobody
 * configured or a mailbox SES refused; `fromPromise` is the seam that turns that into
 * the same `Result` a malformed event produces, so the caller has one path to map.
 */
async function processEvent(
  event: StripeEvent,
  deps: HandlerDeps,
  now: () => number,
): Promise<Result<IssueOutcome, BillingError>> {
  const issuer = issuerFor(deps, now);
  if (issuer.isErr()) return err(issuer.error);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = readCheckoutSession(event.object);
      if (session === null) {
        return err(
          new BillingError(
            "malformed-event",
            `checkout.session.completed ${event.id} has no session id or customer`,
          ),
        );
      }
      return fromPromise(issueFromCheckout(issuer.value, session), billingFailureOf);
    }
    case "invoice.paid": {
      const invoice = readInvoice(event.object);
      if (invoice === null) {
        return err(
          new BillingError(
            "malformed-event",
            `invoice.paid ${event.id} has no invoice id or customer`,
          ),
        );
      }
      return fromPromise(issueFromInvoice(issuer.value, invoice), billingFailureOf);
    }
    default:
      return ok({ status: "ignored", reason: event.type });
  }
}

/** The one failure → response mapping; the code in the body is what a caller can act on. */
function failureOf(error: BillingError): { code: BillingFailure; problem: string } {
  return { code: error.code, problem: error.message };
}

/**
 * The routes that are not the webhook. Built per invocation — they hold no
 * state but the logger — and answered before the store or the email transport
 * is warmed, because a checkout needs neither.
 */
function frontDoorRoute(
  env: BillingEnvironment,
  log: Logger,
  fetch: StripeFetch,
  path: string | null,
): BillingRoute | null {
  if (path === null) return null;
  const deps = { env, log, fetch };
  if (path === CHECKOUT_PATH) return createCheckoutRoute(deps);
  if (path === PORTAL_PATH) return createPortalRoute(deps);
  return null;
}

export function createHandler(deps: HandlerDeps): BillingHandler {
  const log = deps.log ?? jsonLogger;
  const now = deps.now ?? Date.now;
  const stripeFetch = deps.stripeFetch ?? globalFetch;

  return async function billingHandler(event) {
    // The path decides the route before anything else happens. A front door
    // request is not a delivery and must never reach the signature check, and an
    // unknown path is a 404 rather than a webhook attempt.
    const path = pathOf(event);
    const frontDoor = frontDoorRoute(deps.env, log, stripeFetch, path);
    if (frontDoor !== null) return frontDoor(event);
    if (path !== null && path !== WEBHOOK_PATH) {
      log("warn", "route not found", { path: path.slice(0, 128) });
      return json(404, { ok: false, error: "not-found" });
    }

    // First, before the signature is even read: a disabled deployment cannot
    // mint a licence no matter what arrives. 503 rather than 200 tells Stripe
    // the delivery was not handled, so a misconfigured function is visible in
    // the dashboard instead of silently swallowing a paid event.
    if (!billingEnabled(deps.env)) {
      log("warn", "billing refused", { code: "billing-disabled" });
      return json(503, { ok: false, error: "billing-disabled" });
    }

    const rawBody = rawBodyOf(event);
    if (rawBody === null) {
      log("warn", "webhook rejected", { code: "missing-body" });
      return json(400, { ok: false, error: "missing-body" });
    }

    const verification = verifyStripeSignature({
      rawBody,
      header: headerOf(event.headers, "stripe-signature"),
      secret: deps.env.STRIPE_WEBHOOK_SECRET,
      now: now(),
    });
    if (!verification.ok) {
      log("warn", "webhook rejected", { code: verification.reason });
      return json(400, { ok: false, error: verification.reason });
    }

    const parsed = parseStripeEvent(
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"),
    );
    if (parsed === null) {
      log("warn", "webhook rejected", { code: "unreadable-event" });
      return json(400, { ok: false, error: "unreadable-event" });
    }

    if (!HANDLED_EVENTS.has(parsed.type)) {
      log("info", "event ignored", { eventId: parsed.id, eventType: parsed.type });
      return json(200, { ok: true, status: "ignored" });
    }

    // The claim is the idempotency gate. Unknown events never reach it, so an
    // ignored delivery leaves no trace at all.
    const claimed = await deps.store.claimEvent(parsed.id);
    if (!claimed) {
      log("info", "duplicate delivery ignored", {
        eventId: parsed.id,
        eventType: parsed.type,
      });
      return json(200, { ok: true, status: "duplicate" });
    }

    const processed = await processEvent(parsed, deps, now);
    if (processed.isErr()) {
      try {
        await deps.store.releaseEvent(parsed.id);
      } catch {
        // A failed release only costs a duplicate check on the retry; the 500
        // still has to reach Stripe so it retries.
      }
      const failure = failureOf(processed.error);
      log("error", "webhook failed", {
        eventId: parsed.id,
        eventType: parsed.type,
        code: failure.code,
        problem: failure.problem,
      });
      return json(500, { ok: false, error: "processing-failed", code: failure.code });
    }

    const outcome = processed.value;
    log(
      "info",
      outcome.status === "unchanged" ? "licence already current" : "licence event handled",
      {
        eventId: parsed.id,
        eventType: parsed.type,
        status: outcome.status,
        ...(outcome.status === "ignored"
          ? { reason: outcome.reason }
          : {
              customerId: outcome.record.customerId,
              licenceId: outcome.record.licenceId,
              tier: outcome.record.tier,
              expiresAt: outcome.record.expiresAt,
            }),
      },
    );
    return json(200, { ok: true, status: outcome.status });
  };
}

/**
 * Warm-container store. The in-memory default is enough for a retry that lands
 * on the same Lambda instance, not enough to be correct; set
 * `SUITE_BILLING_STORE=postgres` before the endpoint takes real money.
 *
 * The promise is cached so concurrent invocations share one client, and a
 * failed construction is dropped so the next invocation can try again.
 */
let storePromise: Promise<BillingStore> | null = null;

function sharedStore(env: BillingEnvironment): Promise<BillingStore> {
  if (storePromise === null) {
    const pending = billingStoreFor(env);
    storePromise = pending;
    pending.catch(() => {
      storePromise = null;
    });
  }
  return storePromise;
}

let emailerPromise: Promise<Emailer> | null = null;

function sharedEmailer(env: BillingEnvironment): Promise<Emailer> {
  if (emailerPromise === null) {
    const pending = emailerFromEnvironment(env.SES_FROM_ADDRESS, env.SUITE_SES_REGION, jsonLogger);
    emailerPromise = pending;
    // Do not cache a failed warm-up: the next invocation should try again.
    pending.catch(() => {
      emailerPromise = null;
    });
  }
  return emailerPromise;
}

export async function handler(event: LambdaHttpEvent): Promise<LambdaHttpResponse> {
  const env = environment();

  // The front door first, and before any transport is warmed: a checkout needs
  // no store and no SES, so a broken email identity must not stop a customer
  // from paying. The route refuses on its own when billing is off.
  const path = pathOf(event);
  const frontDoor = frontDoorRoute(env, jsonLogger, globalFetch, path);
  if (frontDoor !== null) return frontDoor(event);
  if (path !== null && path !== WEBHOOK_PATH) {
    return json(404, { ok: false, error: "not-found" });
  }

  // Closed before any transport is warmed: a disabled deployment must not load
  // SES, read a key or touch the store.
  if (!billingEnabled(env)) {
    jsonLogger("warn", "billing refused", { code: "billing-disabled" });
    return json(503, { ok: false, error: "billing-disabled" });
  }

  let store: BillingStore;
  try {
    store = await sharedStore(env);
  } catch (error) {
    // A misconfigured durable store must fail loudly: falling back to memory
    // would process the event and lose the claim, so the retry could mint twice.
    const failure = failureOf(billingFailureOf(error));
    jsonLogger("error", "billing store unavailable", {
      backend: billingStoreBackend(env),
      code: failure.code,
      problem: failure.problem,
    });
    return json(500, { ok: false, error: "processing-failed", code: "store-unavailable" });
  }

  let emailer: Emailer;
  try {
    emailer = await sharedEmailer(env);
  } catch (error) {
    // A missing SDK or an unusable SES identity breaks every delivery; answer
    // 500 so Stripe keeps retrying while the deployment is fixed, rather than
    // throwing and leaving the caller with an opaque gateway error.
    const failure = failureOf(billingFailureOf(error));
    jsonLogger("error", "email transport unavailable", {
      code: failure.code,
      problem: failure.problem,
    });
    return json(500, { ok: false, error: "processing-failed", code: "email-transport" });
  }

  return createHandler({ store, emailer, env, log: jsonLogger })(event);
}
