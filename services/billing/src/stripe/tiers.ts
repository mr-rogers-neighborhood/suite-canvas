import { err, ok, type Result } from "neverthrow";
import { BillingError } from "../errors.ts";

/**
 * The tier table: the one place a price becomes a set of limits.
 *
 * `STRIPE_PRICE_TIERS` maps Stripe price ids onto what a customer bought, and nothing
 * else in the service needs to know the JSON. Parsing answers with a `Result` because a
 * broken table is an operator's mistake the caller must report, not an exception.
 *
 * The table feeds both halves of billing:
 *
 * - `plansOf` turns it into the auth plugin's static plan list, so checkout offers one
 *   plan per tier with its limits attached;
 * - `tierTableByTier` answers the entitlement read, which looks a subscription's plan
 *   name up here and finds no numbers anywhere else.
 */

/**
 * Members a plan admits when the table does not say: one.
 *
 * A plan includes a fixed number of people and there is no per-seat price, so this is a
 * default rather than a ceiling. A table written before the field existed sold one seat,
 * which is what an operator gets by leaving it out.
 */
export const SEATS_PER_PLAN = 1;

/** A tier is configuration: `STRIPE_PRICE_TIERS` maps price ids onto these. */
export interface TierPlan {
  tier: string;
  /** Members the plan admits, owner included. Defaults to {@link SEATS_PER_PLAN}. */
  seats: number;
  workspaces: number;
  documentBytes: number;
  attachmentBytes: number;
}

export type TierTable = ReadonlyMap<string, TierPlan>;

const MAX_TIER_LENGTH = 64;

function isWholeNumber(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function isPlanEntry(value: unknown): value is TierPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.tier === "string" &&
    entry.tier.trim().length > 0 &&
    entry.tier.length <= MAX_TIER_LENGTH &&
    (entry.seats === undefined || isWholeNumber(entry.seats, 1)) &&
    isWholeNumber(entry.workspaces, 1) &&
    isWholeNumber(entry.documentBytes, 0) &&
    isWholeNumber(entry.attachmentBytes, 0)
  );
}

/**
 * Reads `STRIPE_PRICE_TIERS`:
 *
 *   {"price_123":{"tier":"personal","seats":5,"workspaces":2147483647,"documentBytes":268435456,"attachmentBytes":10737418240}}
 *
 * `seats` may be left out, which admits one member: that is what every table written
 * before the field existed sold. The number is the plan's own allowance, not a price: no
 * plan carries a per-seat price, so a bigger team buys the plan that includes more people
 * rather than more seats of the same plan.
 *
 * A price that is missing from the table is a configuration failure, not a silent free
 * plan: the customer paid, so the operator has to fix the table.
 */
export function parseTierTable(raw: string | null | undefined): Result<TierTable, BillingError> {
  const text = raw?.trim();
  if (!text) {
    return err(new BillingError("invalid-config", "STRIPE_PRICE_TIERS is not set"));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err(new BillingError("invalid-config", "STRIPE_PRICE_TIERS is not valid JSON"));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(
      new BillingError(
        "invalid-config",
        "STRIPE_PRICE_TIERS must be a JSON object keyed by price id",
      ),
    );
  }

  const table = new Map<string, TierPlan>();
  for (const [priceId, entry] of Object.entries(parsed)) {
    if (!isPlanEntry(entry)) {
      return err(
        new BillingError(
          "invalid-config",
          `STRIPE_PRICE_TIERS["${priceId}"] needs tier, workspaces, documentBytes and attachmentBytes; seats, when named, is a whole number of at least one`,
        ),
      );
    }
    table.set(priceId.trim(), {
      tier: entry.tier.trim(),
      seats: entry.seats ?? SEATS_PER_PLAN,
      workspaces: entry.workspaces,
      documentBytes: entry.documentBytes,
      attachmentBytes: entry.attachmentBytes,
    });
  }
  if (table.size === 0) {
    return err(new BillingError("invalid-config", "STRIPE_PRICE_TIERS maps no prices"));
  }
  return ok(table);
}

/**
 * Tier label → plan, keyed in lower case.
 *
 * The Stripe plugin stores `subscription.plan` as the plan name lower-cased, so the read
 * side has to match it that way. Two prices naming one tier (a monthly and an annual)
 * collapse to one entry; their limits are the same.
 */
export function tierTableByTier(tiers: TierTable): ReadonlyMap<string, TierPlan> {
  const byTier = new Map<string, TierPlan>();
  for (const plan of tiers.values()) {
    byTier.set(plan.tier.trim().toLowerCase(), plan);
  }
  return byTier;
}

/**
 * The caps a plan carries, as the `limits` record the plugin and the token both use.
 *
 * `seats` is not one of them: seats bound an organization's member rows and are enforced
 * from `organization_licences` by the control plane, while `limits` is what the relay
 * enforces against a document. Putting a seat count in the token would give one number
 * two readers with no way to tell which answer is which.
 */
export function limitsOf(plan: TierPlan): Readonly<Record<string, number>> {
  return {
    workspaces: plan.workspaces,
    // A plan is bought by an organization and admits its members; the count belongs with
    // the other allowances because it is one, and because a surface that lists what a plan
    // buys has to say how many people it covers.
    seats: plan.seats,
    documentBytes: plan.documentBytes,
    attachmentBytes: plan.attachmentBytes,
  };
}
