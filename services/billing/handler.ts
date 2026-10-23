import { type Emailer, emailerFromEnvironment } from "./email.ts";
import {
  BillingError,
  type IssueOutcome,
  type Issuer,
  issueFromCheckout,
  issueFromInvoice,
  parseTierTable,
} from "./issue.ts";
import { jsonLogger, type Logger } from "./log.ts";
import { type BillingStore, memoryStore } from "./store.ts";
import {
  parseStripeEvent,
  readCheckoutSession,
  readInvoice,
  type StripeEvent,
  verifyStripeSignature,
} from "./stripe.ts";

/**
 * The Lambda entry point: one HTTPS POST from Stripe in, one signed licence
 * out.
 *
 * Status codes are the whole retry protocol:
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
 * Nothing in this file ever writes the token to the log.
 */

/** Everything the webhook reads from the environment, once per invocation. */
export interface BillingEnvironment {
  /**
   * `1` (or `true`) allows the endpoint to mint a licence. Anything else —
   * including unset — refuses, which is the alpha default: hosted billing is
   * not open, so a deployed function must not be able to issue a token by
   * accident.
   */
  SUITE_BILLING_ENABLED: string | undefined;
  STRIPE_WEBHOOK_SECRET: string | undefined;
  SUITE_LICENCE_PRIVATE_KEY: string | undefined;
  STRIPE_PRICE_TIERS: string | undefined;
  SUITE_SELF_HOST_URL: string | undefined;
  SES_FROM_ADDRESS: string | undefined;
  SUITE_SES_REGION: string | undefined;
  /**
   * `dynamodb` makes the event claims and customer records durable across
   * containers. Unset — the alpha default — keeps the in-memory store, which
   * is right for tests and dry runs and wrong for real money.
   */
  SUITE_BILLING_STORE: string | undefined;
  /** Table the DynamoDB store reads and writes; required by that backend only. */
  SUITE_BILLING_TABLE: string | undefined;
}

export const DEFAULT_SELF_HOST_URL =
  "https://github.com/mr-rogers-neighborhood/suite-canvas#deployment";

export function environment(
  source: Record<string, string | undefined> = process.env,
): BillingEnvironment {
  return {
    // Defaulted here rather than at the call site, so every deployment path
    // starts closed and opening it is one explicit variable.
    SUITE_BILLING_ENABLED: source.SUITE_BILLING_ENABLED ?? "0",
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    SUITE_LICENCE_PRIVATE_KEY: source.SUITE_LICENCE_PRIVATE_KEY,
    STRIPE_PRICE_TIERS: source.STRIPE_PRICE_TIERS,
    SUITE_SELF_HOST_URL: source.SUITE_SELF_HOST_URL,
    SES_FROM_ADDRESS: source.SES_FROM_ADDRESS,
    SUITE_SES_REGION: source.SUITE_SES_REGION,
    SUITE_BILLING_STORE: source.SUITE_BILLING_STORE,
    SUITE_BILLING_TABLE: source.SUITE_BILLING_TABLE,
  };
}

/**
 * The closed-by-default switch. Only the two spellings an operator types on
 * purpose open the door; `0`, `false`, empty and unset all refuse.
 */
export function billingEnabled(env: BillingEnvironment): boolean {
  const raw = env.SUITE_BILLING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export type BillingStoreBackend = "memory" | "dynamodb";

/**
 * Only the one deliberate spelling selects DynamoDB; everything else — unset,
 * `memory`, a typo — keeps the in-memory store, which is the alpha default.
 */
export function billingStoreBackend(env: BillingEnvironment): BillingStoreBackend {
  return env.SUITE_BILLING_STORE?.trim().toLowerCase() === "dynamodb" ? "dynamodb" : "memory";
}

/**
 * The adapter is imported only when it is selected, so a deployment on the
 * in-memory store never loads the AWS SDK (and never needs it installed).
 * A construction failure is thrown, not swallowed: answering 500 keeps Stripe
 * retrying instead of silently falling back to a store that cannot remember a
 * claim between containers.
 */
export async function billingStoreFor(
  env: BillingEnvironment,
  log: Logger = jsonLogger,
): Promise<BillingStore> {
  if (billingStoreBackend(env) === "memory") return memoryStore();
  const { dynamoDbStoreFromEnvironment } = await import("./store-dynamodb.ts");
  return dynamoDbStoreFromEnvironment({ table: env.SUITE_BILLING_TABLE, log });
}

/** API Gateway (REST or HTTP API) proxy event, narrowed to what we read. */
export interface LambdaHttpEvent {
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
  isBase64Encoded?: boolean;
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
}

export type BillingHandler = (event: LambdaHttpEvent) => Promise<LambdaHttpResponse>;

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

function issuerFor(deps: HandlerDeps, now: () => number): Issuer {
  return {
    store: deps.store,
    tiers: parseTierTable(deps.env.STRIPE_PRICE_TIERS),
    emailer: deps.emailer,
    privateKeyPem: privateKeyOf(deps.env),
    selfHostUrl: deps.env.SUITE_SELF_HOST_URL?.trim() || DEFAULT_SELF_HOST_URL,
    now,
  };
}

async function processEvent(
  event: StripeEvent,
  deps: HandlerDeps,
  now: () => number,
): Promise<IssueOutcome> {
  const issuer = issuerFor(deps, now);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = readCheckoutSession(event.object);
      if (session === null) {
        throw new BillingError(
          "malformed-event",
          `checkout.session.completed ${event.id} has no session id or customer`,
        );
      }
      return issueFromCheckout(issuer, session);
    }
    case "invoice.paid": {
      const invoice = readInvoice(event.object);
      if (invoice === null) {
        throw new BillingError(
          "malformed-event",
          `invoice.paid ${event.id} has no invoice id or customer`,
        );
      }
      return issueFromInvoice(issuer, invoice);
    }
    default:
      return { status: "ignored", reason: event.type };
  }
}

function failureOf(error: unknown): { code: string; problem: string } {
  if (error instanceof BillingError) return { code: error.code, problem: error.message };
  if (error instanceof Error)
    return { code: "unexpected", problem: `${error.name}: ${error.message}` };
  return { code: "unexpected", problem: String(error) };
}

export function createHandler(deps: HandlerDeps): BillingHandler {
  const log = deps.log ?? jsonLogger;
  const now = deps.now ?? Date.now;

  return async function billingHandler(event) {
    // First, before the signature is even read: a disabled deployment cannot
    // mint a licence no matter what arrives. 503 rather than 200 tells Stripe
    // the delivery was not handled, so a misconfigured function is visible in
    // the dashboard instead of silently swallowing a paid event.
    if (!billingEnabled(deps.env)) {
      log("warn", "webhook refused", { code: "billing-disabled" });
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

    try {
      const outcome = await processEvent(parsed, deps, now);
      const fields = {
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
      };
      log(
        "info",
        outcome.status === "unchanged" ? "licence already current" : "licence event handled",
        fields,
      );
      return json(200, { ok: true, status: outcome.status });
    } catch (error) {
      try {
        await deps.store.releaseEvent(parsed.id);
      } catch {
        // A failed release only costs a duplicate check on the retry; the 500
        // still has to reach Stripe so it retries.
      }
      const failure = failureOf(error);
      log("error", "webhook failed", {
        eventId: parsed.id,
        eventType: parsed.type,
        code: failure.code,
        problem: failure.problem,
      });
      return json(500, { ok: false, error: "processing-failed", code: failure.code });
    }
  };
}

/**
 * Warm-container store. The in-memory default is enough for a retry that lands
 * on the same Lambda instance, not enough to be correct; set
 * `SUITE_BILLING_STORE=dynamodb` before the endpoint takes real money. See
 * docs/billing.md.
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

  // Closed before any transport is warmed: a disabled deployment must not load
  // SES, read a key or touch the store.
  if (!billingEnabled(env)) {
    jsonLogger("warn", "webhook refused", { code: "billing-disabled" });
    return json(503, { ok: false, error: "billing-disabled" });
  }

  let store: BillingStore;
  try {
    store = await sharedStore(env);
  } catch (error) {
    // A misconfigured durable store must fail loudly: falling back to memory
    // would process the event and lose the claim, so the retry could mint twice.
    const failure = failureOf(error);
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
    const failure = failureOf(error);
    jsonLogger("error", "email transport unavailable", {
      code: failure.code,
      problem: failure.problem,
    });
    return json(500, { ok: false, error: "processing-failed", code: "email-transport" });
  }

  return createHandler({ store, emailer, env, log: jsonLogger })(event);
}
