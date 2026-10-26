import { readFileSync } from "node:fs";
import type { TierPlan, TierTable } from "../stripe/tiers.ts";

/**
 * The local Stripe fixtures, read from `deploy/stripe/fixtures.json`.
 *
 * The numbers and lookup keys a developer's test-mode account is set up with live in that
 * one file, so a test asserts the limits an operator actually creates instead of a second
 * copy that drifts. Stripe mints the price ids, so the table here uses the same ids the
 * old fixtures did.
 */

export const PRICE_SOLO = "price_solo";
export const PRICE_SOLO_PRO = "price_solo_pro";

export const NOW = 1_800_000_000_000;
export const DAY = 24 * 60 * 60 * 1000;

export interface FixturePlan {
  tier: string;
  name: string;
  lookupKey: string;
  unitAmount: number;
  seats: number;
  workspaces: number;
  documentBytes: number;
  attachmentBytes: number;
}

const FIXTURES_URL = new URL("../../../../deploy/stripe/fixtures.json", import.meta.url);

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`deploy/stripe/fixtures.json: ${field} must be a non-empty string`);
  }
  return value;
}

function whole(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`deploy/stripe/fixtures.json: ${field} must be a whole number`);
  }
  return value;
}

/** The plans in the fixtures file, in file order. */
export function fixturePlans(): FixturePlan[] {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("plans" in parsed)) {
    throw new Error("deploy/stripe/fixtures.json has no plans array");
  }
  const plans = (parsed as { plans: unknown }).plans;
  if (!Array.isArray(plans)) throw new Error("deploy/stripe/fixtures.json plans is not an array");
  return plans.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`deploy/stripe/fixtures.json: plans[${index}] is not an object`);
    }
    const plan = entry as Record<string, unknown>;
    return {
      tier: text(plan.tier, `plans[${index}].tier`),
      name: text(plan.name, `plans[${index}].name`),
      lookupKey: text(plan.lookupKey, `plans[${index}].lookupKey`),
      unitAmount: whole(plan.unitAmount, `plans[${index}].unitAmount`),
      seats: whole(plan.seats, `plans[${index}].seats`),
      workspaces: whole(plan.workspaces, `plans[${index}].workspaces`),
      documentBytes: whole(plan.documentBytes, `plans[${index}].documentBytes`),
      attachmentBytes: whole(plan.attachmentBytes, `plans[${index}].attachmentBytes`),
    };
  });
}

/** `STRIPE_PRICE_TIERS` as a local development environment would have it. */
export function tierTableFixture(): TierTable {
  const priceIds = [PRICE_SOLO, PRICE_SOLO_PRO];
  const table = new Map<string, TierPlan>();
  for (const [index, plan] of fixturePlans().entries()) {
    const priceId = priceIds[index];
    if (priceId === undefined) throw new Error("more fixture plans than price ids");
    table.set(priceId, {
      tier: plan.tier,
      seats: plan.seats,
      workspaces: plan.workspaces,
      documentBytes: plan.documentBytes,
      attachmentBytes: plan.attachmentBytes,
    });
  }
  return table;
}

/** The limits of one fixture plan, by tier label. */
export function fixtureLimits(tier: string): TierPlan {
  const plan = fixturePlans().find((entry) => entry.tier === tier);
  if (plan === undefined) throw new Error(`no fixture plan named ${tier}`);
  return {
    tier: plan.tier,
    seats: plan.seats,
    workspaces: plan.workspaces,
    documentBytes: plan.documentBytes,
    attachmentBytes: plan.attachmentBytes,
  };
}

/** The fixture plans as the `STRIPE_PRICE_TIERS` JSON an operator would set. */
export function fixturedTiersJson(): string {
  const priceIds = [PRICE_SOLO, PRICE_SOLO_PRO];
  const table: Record<string, TierPlan> = {};
  for (const [index, plan] of fixturePlans().entries()) {
    const priceId = priceIds[index];
    if (priceId === undefined) throw new Error("more fixture plans than price ids");
    table[priceId] = {
      tier: plan.tier,
      seats: plan.seats,
      workspaces: plan.workspaces,
      documentBytes: plan.documentBytes,
      attachmentBytes: plan.attachmentBytes,
    };
  }
  return JSON.stringify(table);
}
