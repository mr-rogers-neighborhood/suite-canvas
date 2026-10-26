import {
  type AuthorizeReferenceAction,
  type StripeOptions,
  type StripePlan,
  stripe,
} from "@better-auth/stripe";
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import Stripe from "stripe";
import { BillingError } from "../errors.ts";
import { limitsOf, type TierTable } from "./tiers.ts";

/**
 * Billing as an auth plugin.
 *
 * `@better-auth/stripe` owns the customer, checkout, the billing portal, the webhook,
 * the subscription row, trials and seat sync (ADR-0078). What this module adds is the
 * three decisions the plugin cannot make for us:
 *
 * 1. **The plan list.** One plan per tier, with the caps from `STRIPE_PRICE_TIERS`
 *    attached as `limits`, so the price a customer chooses is the limit the relay later
 *    enforces.
 * 2. **The reference.** A subscription belongs to an organization, because a workspace
 *    is owned by one and seats come from member rows. The plugin defaults
 *    `customerType` to `user`, so a checkout that names no organization is refused
 *    rather than quietly billing an individual.
 * 3. **The webhook secret.** Passed in, never read from a global at request time.
 *
 * Everything is registered under `/api/auth/*` by the auth instance this is handed to.
 * The webhook path is `/api/auth/stripe/webhook`, and nothing else may serve it.
 */

/** What a membership check has to answer before a checkout or a portal call proceeds. */
export interface AuthorizeOrganizationInput {
  userId: string;
  organizationId: string;
  action: AuthorizeReferenceAction;
}

export interface BillingPluginDeps {
  /** Stripe secret or restricted key. A test key is what a local flow uses. */
  secretKey: string;
  /** The endpoint secret printed by `stripe listen`, never logged. */
  webhookSecret: string;
  /** `STRIPE_PRICE_TIERS`, parsed. The only source of plan names and limits. */
  tiers: TierTable;
  /**
   * Whether this user administers this organization.
   *
   * Injected because membership lives in `@suite/auth`, and billing must not reach into
   * the identity tables itself. A `false` answer refuses the checkout, the portal and
   * every subscription action.
   */
  authorizeOrganization: (input: AuthorizeOrganizationInput) => Promise<boolean>;
  /** Creates a Stripe customer on sign-up. On by default; off is not a supported shape. */
  createCustomerOnSignUp?: boolean;
}

/**
 * The plugin's plan list: one entry per tier, first price wins.
 *
 * Two prices can name one tier (a monthly and an annual). The plugin sells one plan per
 * name, so the first price in the table is the one checkout offers, exactly as the
 * hand-written front door did.
 */
export function planList(tiers: TierTable): StripePlan[] {
  const plans: StripePlan[] = [];
  const named = new Set<string>();
  for (const [priceId, plan] of tiers) {
    const name = plan.tier.trim();
    const key = name.toLowerCase();
    if (named.has(key)) continue;
    named.add(key);
    plans.push({ name, priceId, limits: limitsOf(plan) });
  }
  return plans;
}

function required(value: string, variable: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BillingError("not-configured", `${variable} is not set`);
  }
  return trimmed;
}

/**
 * The plugin's options, before the plugin is constructed.
 *
 * Exported so a test can read what a deployment would configure (the plan list, the
 * reference rule) without a live auth instance or a Stripe account.
 *
 * Throws `BillingError` on a configuration it cannot work with, because the caller is
 * the process boot: a deployment that reaches this with no key, no webhook secret or an
 * empty plan list should fail loudly instead of serving a checkout that cannot charge.
 */
export function billingPluginOptions(deps: BillingPluginDeps): StripeOptions {
  const secretKey = required(deps.secretKey, "STRIPE_SECRET_KEY");
  const webhookSecret = required(deps.webhookSecret, "STRIPE_WEBHOOK_SECRET");
  const plans = planList(deps.tiers);
  if (plans.length === 0) {
    throw new BillingError("invalid-config", "STRIPE_PRICE_TIERS names no plan");
  }

  return {
    stripeClient: new Stripe(secretKey),
    stripeWebhookSecret: webhookSecret,
    createCustomerOnSignUp: deps.createCustomerOnSignUp ?? true,
    // Turns on organization customers: the row, the seat sync and the delete guard.
    organization: { enabled: true },
    subscription: {
      enabled: true,
      // Sign-in already requires a verified address; this keeps an unverified session
      // from starting a subscription through an endpoint called directly.
      requireEmailVerification: true,
      plans,
      authorizeReference: async ({ user, referenceId, action }) =>
        deps.authorizeOrganization({
          userId: user.id,
          organizationId: referenceId,
          action,
        }),
      /**
       * Refuses a checkout whose reference is not an organization this user administers.
       *
       * Without this the plugin falls back to `customerType: "user"` and bills an
       * individual, which would put subscription state outside the tenant that owns the
       * workspaces. The client asks for `customerType: "organization"` and passes
       * `referenceId`; both ids are written onto the Checkout Session so the Stripe
       * dashboard names the same organization support does.
       */
      getCheckoutSessionParams: async ({ user, subscription }) => {
        const allowed = await deps.authorizeOrganization({
          userId: user.id,
          organizationId: subscription.referenceId,
          action: "upgrade-subscription",
        });
        if (!allowed) {
          // A 400, not a thrown `BillingError`: the caller sent a reference it does not
          // administer, and a 500 here would read as our fault in the Stripe logs.
          throw new APIError("BAD_REQUEST", {
            message:
              'a subscription belongs to an organization: send customerType "organization" with an organizationId this account administers',
            code: "ORGANIZATION_REFERENCE_REQUIRED",
          });
        }
        return {
          params: {
            client_reference_id: subscription.referenceId,
            metadata: { organizationId: subscription.referenceId },
          },
        };
      },
    },
  };
}

/** The plugin to hand to `authOptions({ billingPlugin })`. */
export function createBillingPlugin(deps: BillingPluginDeps): BetterAuthPlugin {
  // The plugin object satisfies `BetterAuthPlugin`; the cast states that across a
  // `better-call` endpoint type that is only structural at run time.
  return stripe(billingPluginOptions(deps)) as unknown as BetterAuthPlugin;
}
