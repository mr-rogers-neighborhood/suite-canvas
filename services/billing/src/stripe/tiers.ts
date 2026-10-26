import { err, ok, type Result } from "neverthrow";
import { BillingError } from "../errors.ts";

/**
 * The tier table: the one place configuration becomes a licence payload.
 *
 * `STRIPE_PRICE_TIERS` maps Stripe price ids onto what a customer bought, and nothing
 * else in the service needs to know the JSON. Parsing answers with a `Result` because a
 * broken table is an operator's mistake the caller must report, not an exception; the
 * `BillingError` it carries is the same one the webhook logs and the front door answers.
 */

/** A tier is configuration: `STRIPE_PRICE_TIERS` maps price ids onto these. */
export interface TierPlan {
  tier: string;
  workspaces: number;
  documentBytes: number;
  attachmentBytes: number;
}

export type TierTable = ReadonlyMap<string, TierPlan>;

/**
 * One paid period, used when Stripe does not say how long the period is
 * (a bare Checkout Session carries no period bounds).
 */
export const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

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
    isWholeNumber(entry.workspaces, 1) &&
    isWholeNumber(entry.documentBytes, 0) &&
    isWholeNumber(entry.attachmentBytes, 0)
  );
}

/**
 * Reads `STRIPE_PRICE_TIERS`:
 *
 *   {"price_123":{"tier":"solo","workspaces":3,"documentBytes":268435456,"attachmentBytes":1073741824}}
 *
 * A price that is missing from the table is a 500, not a silent free licence:
 * the customer paid, so the operator has to fix the table and let Stripe retry.
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
          `STRIPE_PRICE_TIERS["${priceId}"] needs tier, workspaces, documentBytes and attachmentBytes`,
        ),
      );
    }
    table.set(priceId.trim(), {
      tier: entry.tier.trim(),
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
 * Price id → plan, or the `unknown-price` failure that makes Stripe retry.
 *
 * This one throws where {@link parseTierTable} returns a `Result`, and the difference
 * is the caller: every caller of `planFor` is an issuing function that already fails by
 * throwing its own `BillingError`, so wrapping the lookup would only move the throw one
 * line up. The table is parsed at the shell, where a `Result` removes a `try`.
 */
export function planFor(
  tiers: TierTable,
  priceId: string | null,
): { plan: TierPlan; priceId: string } {
  if (priceId === null) {
    throw new BillingError(
      "unknown-price",
      "the event carries no price id; set metadata.price_id when the session is created",
    );
  }
  const plan = tiers.get(priceId);
  if (plan === undefined) {
    throw new BillingError("unknown-price", `no tier is configured for price ${priceId}`);
  }
  return { plan, priceId };
}
