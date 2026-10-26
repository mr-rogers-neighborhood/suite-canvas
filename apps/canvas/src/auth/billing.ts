/**
 * Billing, as the auth plugin serves it (ADR-0078).
 *
 * `@better-auth/stripe` registers checkout, the customer portal and the
 * subscription list under `/api/auth/*`; the control plane serves the plan
 * catalogue and the entitlement read under `/api/billing/*` beside it. So this
 * module is a handful of `fetch` calls and no Stripe client: the secret key never
 * reaches a browser, and the plan names come from the server rather than a table
 * copied here.
 *
 * Two rules the server enforces and this module respects:
 *
 * - a subscription belongs to an **organization**, so every call names
 *   `customerType: "organization"` and a `referenceId` this account administers;
 * - an unverified address cannot start a subscription, so a refusal reads as
 *   "verify your email" rather than a dead button.
 */

import { authClientBase, authServiceBase } from "./endpoints";
import { ensureOrganization, ORGANIZATION_NAME } from "./organization";

/** Where the plugin mounts its routes. */
export const BILLING_PATHS = {
  upgrade: "/subscription/upgrade",
  portal: "/subscription/billing-portal",
  list: "/subscription/list",
} as const;

/**
 * The control plane's own billing reads, beside the plugin rather than inside it
 * (ADR-0070, ADR-0078). `docs/reference/billing.md` is the contract: the catalogue
 * and the entitlement read answer from the one tier table, and neither calls
 * Stripe — a payment-provider outage must not stop hosted sync.
 */
export const BILLING_SERVICE_PATH = "/api/billing";
export const PLAN_CATALOGUE_PATH = `${BILLING_SERVICE_PATH}/plans`;
export const ENTITLEMENT_PATH = `${BILLING_SERVICE_PATH}/entitlement`;

/** One plan the deployment sells. The server's answer, never a client table. */
export interface BillingPlan {
  name: string;
  /** Limits that come with the price, when the server sends them. */
  limits: Readonly<Record<string, number>>;
}

export interface SubscriptionView {
  plan: string | null;
  status: string;
  seats: number | null;
  /** Epoch milliseconds, when the server sends a period end. */
  periodEnd: number | null;
}

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim().length > 0) return error.trim();
  }
  return fallback;
}

function codeOf(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) return code.trim();
  }
  return `http-${status}`;
}

/** A reader's answer: `ok: false` is an unexpected shape, not an empty value. */
type Read<T> = { ok: true; value: T } | { ok: false };

/** Where a call goes. `base` is the auth mount; `serviceBase` is the origin it hangs off. */
export interface BillingTarget {
  base?: string;
  serviceBase?: string;
  fetch?: typeof globalThis.fetch;
}

async function call<T>(
  path: string,
  body: Record<string, unknown> | undefined,
  read: (body: unknown) => Read<T>,
  options: BillingTarget = {},
): Promise<BillingResult<T>> {
  const base = options.base ?? authClientBase();
  const send = options.fetch ?? globalThis.fetch;
  const url = path.startsWith("/api/")
    ? `${options.serviceBase ?? authServiceBase()}${path}`
    : `${base}${path}`;
  try {
    const response = await send(url, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? { accept: "application/json" }
          : {
              accept: "application/json",
              "content-type": "application/json",
            },
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        code: codeOf(parsed, response.status),
        message: messageOf(parsed, "The billing service refused that request."),
      };
    }
    const value = read(parsed);
    if (!value.ok) {
      return {
        ok: false,
        code: "unexpected-response",
        message: "The billing service sent an unexpected response.",
      };
    }
    return { ok: true, value: value.value };
  } catch {
    return {
      ok: false,
      code: "unreachable",
      message: "The billing service did not answer, so nothing changed.",
    };
  }
}

/**
 * The plans this deployment sells, in the order the server listed them.
 *
 * `POST /api/billing/plans` is the catalogue built from `STRIPE_PRICE_TIERS`: the
 * one table that also decides every limit, so a price a customer can pick is a
 * price whose caps the relay will enforce.
 */
export function listPlans(options: BillingTarget = {}): Promise<BillingResult<BillingPlan[]>> {
  return call(
    PLAN_CATALOGUE_PATH,
    {},
    (body) => {
      if (typeof body !== "object" || body === null) return { ok: false };
      const record = body as Record<string, unknown>;
      const raw = Array.isArray(record)
        ? record
        : Array.isArray(record.plans)
          ? record.plans
          : null;
      // The plugin answers `{ subscriptions }`; a deployment may add `plans`.
      const plans = Array.isArray(raw)
        ? raw.flatMap((entry): BillingPlan[] => {
            if (typeof entry === "string") return [{ name: entry, limits: {} }];
            if (typeof entry !== "object" || entry === null) return [];
            const plan = entry as Record<string, unknown>;
            const name = typeof plan.name === "string" ? plan.name : null;
            if (name === null) return [];
            const limits: Record<string, number> = {};
            if (typeof plan.limits === "object" && plan.limits !== null) {
              for (const [key, value] of Object.entries(plan.limits as Record<string, unknown>)) {
                if (typeof value === "number" && Number.isFinite(value)) limits[key] = value;
              }
            }
            return [{ name, limits }];
          })
        : [];
      return { ok: true, value: plans };
    },
    options,
  );
}

/** One organization's entitlements, as the control plane reads them. */
export interface EntitlementRead {
  tier: string;
  limits: Readonly<Record<string, number>>;
}

export function readEntitlement(
  organizationId: string,
  options: BillingTarget = {},
): Promise<BillingResult<EntitlementRead>> {
  return call(
    ENTITLEMENT_PATH,
    { organizationId },
    (body) => {
      if (typeof body !== "object" || body === null) return { ok: false };
      const record = body as Record<string, unknown>;
      const limits: Record<string, number> = {};
      if (typeof record.limits === "object" && record.limits !== null) {
        for (const [key, value] of Object.entries(record.limits as Record<string, unknown>)) {
          if (typeof value === "number" && Number.isFinite(value)) limits[key] = value;
        }
      }
      return {
        ok: true,
        value: {
          tier: typeof record.tier === "string" && record.tier.length > 0 ? record.tier : "free",
          limits,
        },
      };
    },
    options,
  );
}

/** This organization's subscription, when there is one. */
export function readSubscription(
  organizationId: string,
  options: BillingTarget = {},
): Promise<BillingResult<SubscriptionView | null>> {
  // `customerType` is not optional here: the plugin defaults it to `user`, which
  // would read an individual's subscription instead of the tenant's.
  const query = new URLSearchParams({ customerType: "organization", referenceId: organizationId });
  return call(
    `${BILLING_PATHS.list}?${query.toString()}`,
    undefined,
    (body) => {
      // The plugin answers a bare array; a deployment may wrap it. Both are the
      // same answer, and no subscription at all is an answer too.
      const rows = Array.isArray(body)
        ? body
        : typeof body === "object" && body !== null
          ? (body as { subscriptions?: unknown }).subscriptions
          : undefined;
      if (rows === undefined || (Array.isArray(rows) && rows.length === 0)) {
        return { ok: true, value: null };
      }
      if (!Array.isArray(rows)) return { ok: false };
      const first = rows[0] as Record<string, unknown>;
      const periodEnd = first.periodEnd;
      return {
        ok: true,
        value: {
          plan: typeof first.plan === "string" ? first.plan : null,
          status: typeof first.status === "string" ? first.status : "unknown",
          seats: typeof first.seats === "number" ? first.seats : null,
          periodEnd:
            periodEnd instanceof Date
              ? periodEnd.getTime()
              : typeof periodEnd === "number"
                ? periodEnd
                : typeof periodEnd === "string"
                  ? Date.parse(periodEnd) || null
                  : null,
        } satisfies SubscriptionView,
      };
    },
    options,
  );
}

export interface CheckoutInput {
  plan: string;
  /** Where Stripe sends the customer back to, success and cancel. */
  returnUrl: string;
  /** Seats to buy; the plan's own default when absent. */
  seats?: number;
  options?: BillingTarget;
}

/**
 * Starts a checkout for one plan. The organization is created on demand: a
 * first-time buyer has no tenant yet, and the subscription is the tenant's.
 */
export async function startCheckout(input: CheckoutInput): Promise<BillingResult<string>> {
  const organization = await ensureOrganization(ORGANIZATION_NAME);
  if (!organization.ok) {
    return { ok: false, code: organization.code, message: organization.message };
  }
  return call(
    BILLING_PATHS.upgrade,
    {
      plan: input.plan,
      customerType: "organization",
      referenceId: organization.organizationId,
      successUrl: input.returnUrl,
      cancelUrl: input.returnUrl,
      returnUrl: input.returnUrl,
      ...(input.seats === undefined ? {} : { seats: input.seats }),
    },
    (body) => {
      if (typeof body !== "object" || body === null) return { ok: false };
      const record = body as Record<string, unknown>;
      const url = record.url ?? record.checkoutUrl;
      return typeof url === "string" && url.length > 0 ? { ok: true, value: url } : { ok: false };
    },
    input.options ?? {},
  );
}

/** Opens the Stripe customer portal, where a plan is changed or cancelled. */
export async function openBillingPortal(input: {
  returnUrl: string;
  options?: BillingTarget;
}): Promise<BillingResult<string>> {
  const organization = await ensureOrganization(ORGANIZATION_NAME);
  if (!organization.ok) {
    return { ok: false, code: organization.code, message: organization.message };
  }
  return call(
    BILLING_PATHS.portal,
    {
      customerType: "organization",
      referenceId: organization.organizationId,
      returnUrl: input.returnUrl,
    },
    (body) => {
      if (typeof body !== "object" || body === null) return { ok: false };
      const url = (body as { url?: unknown }).url;
      return typeof url === "string" && url.length > 0 ? { ok: true, value: url } : { ok: false };
    },
    input.options ?? {},
  );
}
