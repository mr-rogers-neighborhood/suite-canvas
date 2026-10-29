import { limitsOf, type TierTable, tierTableByTier } from "../stripe/tiers.ts";

/**
 * What an organization's subscription buys, read from the row the Stripe plugin writes
 * (ADR-0075).
 *
 * The token is minted every five minutes, so this read is on the hot path of every
 * relay session and it must never invent access. It answers from two places and no
 * others: the `subscription` row for the organization, and the tier table for limits.
 * Stripe is not called, because a payment provider outage would then stop hosted sync
 * for customers who already paid.
 */

/** The tier a session without a paid subscription reports. */
export const FREE_TIER = "free";

/** The signed fields the relay enforces; a limit it does not read is not a limit. */
export interface Entitlement {
  tier: string;
  limits: Readonly<Record<string, number>>;
}

/** No subscription, no organization: the answer a self-hosted deployment gets. */
export const freeEntitlement: Entitlement = { tier: FREE_TIER, limits: {} };

/**
 * The columns this read needs from the plugin's `subscription` table.
 *
 * `periodEnd` is epoch milliseconds, not a `Date`, so the decision below is a pure
 * function of numbers and a test does not have to reason about time zones.
 */
export interface SubscriptionRow {
  plan: string;
  /** Stripe's status vocabulary: `active`, `trialing`, `past_due`, `canceled`, … */
  status: string;
  /** End of the period Stripe last billed, or null when the row has none yet. */
  periodEnd: number | null;
  /**
   * Set when the customer cancelled but the paid period has not ended.
   *
   * It does not shorten the entitlement: an `active` row is inside a period Stripe
   * already collected for, so the customer keeps it until the row turns `canceled`.
   */
  cancelAtPeriodEnd: boolean;
  /**
   * The Stripe universe this row was recorded in (`test` or `live`), or null when the
   * row predates `0012_subscription_billing_mode.sql`.
   *
   * The two universes share no ids, so an `active` row from the other one is a
   * subscription the current deployment cannot bill, cancel or open a portal for. It is
   * not a plan.
   */
  billingMode?: string | null;
}

/** Where a subscription row comes from. One implementation today: Postgres. */
export interface OrganizationSubscriptions {
  /** The live subscription for an organization, or null when it has none. */
  forOrganization: (organizationId: string) => Promise<SubscriptionRow | null>;
}

/** The read the auth plugin's token mint calls, keyed by organization. */
export interface OrganizationEntitlements {
  forOrganization: (organizationId: string) => Promise<Entitlement>;
}

/**
 * Whether a row is inside a period the customer paid for.
 *
 * `active` and `trialing` are the two live states. `past_due` keeps the plan while the
 * last paid period runs, because Stripe is still retrying the card and cutting a
 * customer mid-period is a worse answer than a bounded grace window. Everything else,
 * including a status Stripe adds later, denies: the default has to be no access.
 */
function isLive(row: SubscriptionRow, now: number): boolean {
  switch (row.status) {
    case "active":
    case "trialing":
      return true;
    case "past_due":
      return row.periodEnd !== null && row.periodEnd > now;
    default:
      return false;
  }
}

/**
 * The entitlement for one subscription row.
 *
 * A row whose plan is not in the table denies rather than throwing: the table is the
 * only source of numbers, and a deployment that edited `STRIPE_PRICE_TIERS` while a
 * subscription was live should lose the limits it no longer describes instead of
 * failing every session mint.
 */
export function entitlementFor(
  row: SubscriptionRow | null,
  tiers: TierTable,
  now: number,
  mode?: string | null,
): Entitlement {
  if (row === null || !isLive(row, now)) return freeEntitlement;
  if (!recordedHere(row.billingMode, mode)) return freeEntitlement;
  const plan = tierTableByTier(tiers).get(row.plan.trim().toLowerCase());
  if (plan === undefined) return freeEntitlement;
  return { tier: plan.tier, limits: limitsOf(plan) };
}

/**
 * Whether a row was recorded in the universe this process sells in.
 *
 * A row with no stamp, or a caller that names no mode, answers yes: the unknown case is
 * every row written before the column existed, and refusing it would cut off a paying
 * customer over a migration rather than over a payment. Only a stamp that disagrees with
 * the mode is a refusal, and that case is exactly the one worth refusing: a test-mode
 * subscription granting live sync.
 */
function recordedHere(
  recorded: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  const stamp = typeof recorded === "string" ? recorded.trim().toLowerCase() : "";
  const current = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  if (stamp.length === 0 || current.length === 0) return true;
  return stamp === current;
}

export interface EntitlementReaderDeps {
  subscriptions: OrganizationSubscriptions;
  tiers: TierTable;
  now?: () => number;
  /**
   * The mode this process sells in, so a row from the other universe is not a plan.
   *
   * A value rather than a function: billing is read at boot and a process that has spent
   * one mode cannot honestly describe another, which is what the panel's "restart to
   * apply" marker says in the same words.
   */
  mode?: string | null;
}

/** Binds the row source and the table into the read the auth lane injects. */
export function createEntitlementReader(deps: EntitlementReaderDeps): OrganizationEntitlements {
  const now = deps.now ?? Date.now;
  return {
    forOrganization: async (organizationId) =>
      entitlementFor(
        await deps.subscriptions.forOrganization(organizationId),
        deps.tiers,
        now(),
        deps.mode,
      ),
  };
}
