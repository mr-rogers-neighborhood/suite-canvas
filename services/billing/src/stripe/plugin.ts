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
import {
  type LicenceProjection,
  type PluginSubscription,
  subscriptionViewOf,
} from "../licence/projection.ts";
import { limitsOf, SEATS_PER_PLAN, type TierTable } from "./tiers.ts";

/**
 * Billing as an auth plugin.
 *
 * `@better-auth/stripe` owns the customer, checkout, the billing portal, the webhook,
 * the subscription row, trials and seat sync (ADR-0078). What this module adds is the
 * four decisions the plugin cannot make for us:
 *
 * 1. **The plan list.** One plan per tier, with the caps from `STRIPE_PRICE_TIERS`
 *    attached as `limits`, so the price a customer chooses is the limit the relay later
 *    enforces.
 * 2. **The reference.** A subscription belongs to an organization, because a workspace
 *    is owned by one and seats come from member rows. The plugin defaults
 *    `customerType` to `user`, so a checkout that names no organization is refused
 *    rather than quietly billing an individual.
 * 3. **The webhook secret.** Passed in, never read from a global at request time.
 * 4. **The licence row.** `organization_licences` is what the seat check counts
 *    against, and the plugin's lifecycle hooks are the only place that learns a
 *    subscription changed, so {@link BillingPluginDeps.licence} is called from each of
 *    them (ADR-0075: the tier the token carries and the tier the seat check enforces are
 *    one answer).
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

/** The enabled half of the plugin's `subscription` option, which the hooks live on. */
type SubscriptionHooks = Extract<NonNullable<StripeOptions["subscription"]>, { enabled: true }>;

/** The four hooks a subscription change reaches; every one of them writes the licence. */
type LifecycleHook =
  | "onSubscriptionCreated"
  | "onSubscriptionComplete"
  | "onSubscriptionUpdate"
  | "onSubscriptionDeleted";

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
  /**
   * Writes the organization's licence row from the subscription the plugin just stored.
   *
   * Optional because a deployment may run billing for checkout alone, but a deployment
   * that leaves it out keeps the bug this exists to fix: a subscriber's token says
   * `solo` while their seat check counts a `free` row.
   */
  licence?: LicenceProjection;
  /** Creates a Stripe customer on sign-up. On by default; off is not a supported shape. */
  createCustomerOnSignUp?: boolean;
  /**
   * Whether Checkout shows a promotion-code field. On by default: it is how a comp or a
   * launch discount reaches a customer without this process holding a second price list.
   */
  allowPromotionCodes?: boolean;
  /**
   * A Stripe coupon applied to every checkout, by id.
   *
   * The alternative to a code somebody has to type and remember. During a free alpha it
   * is what makes every checkout total zero, which is also what lets Stripe skip the card
   * (`payment_method_collection: "if_required"`): a subscription whose first invoice is
   * nothing needs no payment method.
   *
   * Stripe refuses `discounts` beside `allow_promotion_codes` on one session, so setting
   * this replaces the field rather than adding to it.
   */
  coupon?: string;
}

/**
 * The subscription lifecycle hooks, as the plugin declares them.
 *
 * `created` and `complete` both fire for a fresh checkout (`customer.subscription.created`
 * and `checkout.session.completed` are separate deliveries), so the projection is called
 * twice for one subscription. That is safe and deliberate: the write is an upsert keyed
 * by the organization, and a duplicate that lands out of order would otherwise leave the
 * older answer in the row.
 */
function licenceHooks(
  licence: LicenceProjection | undefined,
): Partial<Pick<SubscriptionHooks, LifecycleHook>> {
  if (licence === undefined) return {};
  const project = async (subscription: PluginSubscription): Promise<void> => {
    await licence.project(subscriptionViewOf(subscription));
  };
  return {
    onSubscriptionCreated: async ({ subscription }) => project(subscription),
    onSubscriptionComplete: async ({ subscription }) => project(subscription),
    onSubscriptionUpdate: async ({ subscription }) => project(subscription),
    onSubscriptionDeleted: async ({ subscription }) => project(subscription),
  };
}

/**
 * The plugin's plan list: one entry per tier, first price wins.
 *
 * Two prices can name one tier (a monthly and an annual). The plugin sells one plan per
 * name, so the first price in the table is the one checkout offers, exactly as the
 * hand-written front door did.
 *
 * A plan that declares more than one seat is refused rather than sold. Seats are a
 * ceiling on members (`checkSeatAllowance` in `@suite/auth` compares the organization's
 * member count plus the invitee against `organization_licences.seats`), and this build
 * writes that number from the subscription quantity, which the plugin sets to the member
 * count. So a plan priced for a team would admit exactly one person at a team price:
 * the second member is refused before the quantity could ever grow, and no per-seat price
 * exists to charge for the seats beyond it. Refusing the table is the honest answer until
 * that pricing exists (ADR-0082).
 */
export function planList(tiers: TierTable): StripePlan[] {
  const plans: StripePlan[] = [];
  const named = new Set<string>();
  for (const [priceId, plan] of tiers) {
    const name = plan.tier.trim();
    const key = name.toLowerCase();
    if (named.has(key)) continue;
    named.add(key);
    if (plan.seats !== SEATS_PER_PLAN) {
      throw new BillingError(
        "invalid-config",
        `plan "${name}" sells ${plan.seats} seats, and this build sells ${SEATS_PER_PLAN}: there is no per-seat price to charge for the rest (ADR-0082)`,
      );
    }
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
      /**
       * The licence row, written from the row the plugin just stored.
       *
       * `@better-auth/stripe` is the only writer of `subscription`, and its lifecycle
       * hooks are the only notification that the row changed, so the projection rides
       * them rather than polling. A hook that fails is reported by the projection and
       * the plugin answers the webhook 200, which is why the next event repairs the row
       * instead of Stripe retrying this one.
       */
      ...licenceHooks(deps.licence),
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
        const coupon = (deps.coupon ?? "").trim();
        return {
          params: {
            client_reference_id: subscription.referenceId,
            metadata: { organizationId: subscription.referenceId },
            /**
             * A card is collected when it is needed, and not otherwise.
             *
             * The default asks for one on every subscription checkout, which turns a
             * free alpha into a card form in front of a product nobody is paying for: the
             * reader stops, and the sign-up that was meant to cost nothing costs a
             * decision. With `if_required` Stripe asks only when the amount due is above
             * zero, so a fully discounted first invoice goes straight through.
             *
             * The trade is stated where an operator will read it: a subscription with no
             * payment method cannot renew once the discount stops applying.
             */
            payment_method_collection: "if_required",
            ...(coupon.length > 0
              ? // No field to fill in, and no code to lose.
                { discounts: [{ coupon }] }
              : {
                  /**
                   * A promotional code is a Stripe coupon, not a licence grant.
                   *
                   * Stripe owns the discount table, the expiry and the redemption limit,
                   * and the Checkout page has a field for it; the alternative — an
                   * operator typing comps into this process — would be a second source of
                   * truth about what somebody paid. The field is off by default on a
                   * Checkout Session, so it has to be asked for.
                   */
                  allow_promotion_codes: deps.allowPromotionCodes ?? true,
                }),
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
