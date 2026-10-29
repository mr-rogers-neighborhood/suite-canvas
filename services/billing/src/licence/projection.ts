import {
  type Entitlement,
  entitlementFor,
  FREE_TIER,
  type SubscriptionRow,
} from "../entitlement/entitlement.ts";
import type { Queryable } from "../entitlement/postgres.ts";
import type { TierTable } from "../stripe/tiers.ts";

/**
 * `organization_licences`, written from the subscription row.
 *
 * The token and the seat check used to answer the same question from two places, and
 * only one of them kept up: the entitlement read minted the paid tier from the
 * `subscription` row, while `organization_licences` — the table `checkSeatAllowance`
 * counts against — held whatever the free provisioning trigger wrote. A paying customer
 * therefore carried `solo` on their token and was refused a second member by a `free`
 * row: two answers to one question, and the wrong one costs money.
 *
 * The fix is not a second policy. {@link licenceRowFor} takes the *answer*
 * `entitlementFor` already gives, so the row is written from the function the token is
 * minted from, and the tier a subscriber's seat check enforces is the tier their token
 * carries by construction rather than by agreement.
 *
 * Three rules, and each is a decision:
 *
 * - **The row is replaced, never joined.** `organization_licences.organization_id` is
 *   the primary key, so one organization holds exactly one licence (ADR-0065 §7).
 * - **A lapsed subscription falls back to the free row.** Deleting the row would be a
 *   provisioning fault (`licence-unprovisioned`) and would cut a customer off their own
 *   documents; the free tier keeps their data reachable and their bill honest.
 * - **A paid row runs until the period Stripe last billed.** `expires_at` is the period
 *   end, which is the horizon a `past_due` grace window also ends at, so the seat check
 *   and the token run out together.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * The free tier's numbers, structurally.
 *
 * `@suite/auth` owns them (`FREE_LICENCE_TIER`, compared with the provisioning trigger by
 * `pnpm db:verify`) and this package never imports it: `apps/control-plane` passes the
 * object in, and it is the one process that knows both packages.
 */
export interface FreeLicenceTier {
  tier: string;
  workspaces: number;
  seats: number;
  documentBytes: number;
  attachmentBytes: number;
  days: number;
}

/**
 * A subscription row, plus the identity the licence row needs.
 *
 * It extends {@link SubscriptionRow} rather than restating it: the projection and the
 * entitlement read must be looking at the same four fields, or the two answers can differ
 * before either of them is written.
 */
export interface SubscriptionView extends SubscriptionRow {
  /** The organization the subscription belongs to: its `referenceId`. */
  organizationId: string;
  /**
   * Seats the subscription sells: the plugin's quantity, which is the member count for a
   * plan that prices seats and one for a plan that does not.
   */
  seats: number | null;
  /** The Stripe subscription id, so a licence can name the subscription it came from. */
  subscriptionId: string | null;
}

/** One row of `organization_licences`, as this package writes it. */
export interface LicenceRow {
  organizationId: string;
  licenceId: string;
  tier: string;
  workspaces: number;
  seats: number;
  documentBytes: number;
  attachmentBytes: number;
  /** Epoch milliseconds: the paid horizon, or the free tier's long one. */
  expiresAt: number;
}

/** The plugin's `subscription` row, as a lifecycle hook hands it over. */
export interface PluginSubscription {
  referenceId: string;
  plan: string;
  status: string;
  periodEnd?: Date | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
  /**
   * The quantity the plugin resolved for this subscription, on create and on every update
   * (`resolveQuantity` in `@better-auth/stripe`): the seat item's quantity when the plan
   * carries a `seatPriceId`, and otherwise the plan item's quantity, which checkout sets to
   * one. No plan here prices seats, so it is one.
   */
  seats?: number | undefined;
  stripeSubscriptionId?: string | undefined;
}

/**
 * A seat quantity as the plugin reports it, or null when the row does not carry a count.
 *
 * `seats` becomes a licence ceiling, and `checkSeatAllowance` admits `memberCount <=
 * seats`, so a fractional or negative number from a row nobody validated would admit a
 * fraction of a person or drop below the free tier. Anything that is not a whole count is
 * read as "not stated" and the free tier's floor decides.
 */
function seatCountOf(seats: number | undefined): number | null {
  if (typeof seats !== "number" || !Number.isSafeInteger(seats) || seats < 0) return null;
  return seats;
}

/** The plugin's row, as the projection reads it. */
export function subscriptionViewOf(subscription: PluginSubscription): SubscriptionView {
  return {
    organizationId: subscription.referenceId,
    plan: subscription.plan,
    status: subscription.status,
    periodEnd: subscription.periodEnd === undefined ? null : subscription.periodEnd.getTime(),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd === true,
    seats: seatCountOf(subscription.seats),
    subscriptionId: subscription.stripeSubscriptionId ?? null,
  };
}

/** One limit from an entitlement, or the free tier's number when it names none. */
function limitOf(entitlement: Entitlement, key: string, fallback: number): number {
  const value = entitlement.limits[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The row a lapsed or never-subscribed organization holds: the free tier. */
export function freeLicenceRow(
  organizationId: string,
  free: FreeLicenceTier,
  now: number,
): LicenceRow {
  return {
    organizationId,
    // The id `0009_free_licence_provisioning.sql` writes, so a fallback row is
    // indistinguishable from the row the trigger would have written.
    licenceId: `free:${organizationId}`,
    tier: free.tier,
    workspaces: free.workspaces,
    seats: free.seats,
    documentBytes: free.documentBytes,
    attachmentBytes: free.attachmentBytes,
    expiresAt: now + free.days * DAY,
  };
}

/** The row a live subscription holds: the plan's tier, for the period it was paid for. */
function paidLicenceRow(
  subscription: SubscriptionView,
  entitlement: Entitlement,
  free: FreeLicenceTier,
): LicenceRow {
  return {
    organizationId: subscription.organizationId,
    licenceId:
      subscription.subscriptionId === null
        ? `paid:${subscription.organizationId}`
        : `stripe:${subscription.subscriptionId}`,
    tier: entitlement.tier,
    workspaces: limitOf(entitlement, "workspaces", free.workspaces),
    // A plan that sells no seats still admits the owner the free tier admitted, so an
    // upgrade can never take away a seat the organization already had. The number is a
    // ceiling: `checkSeatAllowance` refuses the member whose join would take the count
    // past it with `seat-allowance-exhausted`, which the auth hook reports as
    // `seat-refused`. This build sells one seat per plan (ADR-0082), so a subscriber is
    // the owner and no one else until per-seat pricing exists.
    seats: Math.max(subscription.seats ?? 0, free.seats),
    documentBytes: limitOf(entitlement, "documentBytes", free.documentBytes),
    attachmentBytes: limitOf(entitlement, "attachmentBytes", free.attachmentBytes),
    // Safe: only a live subscription reaches here, and `licenceRowFor` refuses one with
    // no period end.
    expiresAt: subscription.periodEnd ?? 0,
  };
}

export interface LicenceRowInput {
  organizationId: string;
  /** The subscription in force, or null for an organization that has none. */
  subscription: SubscriptionView | null;
  /** What the entitlement read answers for that subscription. */
  entitlement: Entitlement;
  free: FreeLicenceTier;
  now: number;
}

/**
 * The row the seat check must hold for one organization.
 *
 * A paid row needs two things the free row does not: a tier the entitlement read
 * granted, and a period end to run until. A subscription row without a period end cannot
 * say how long it was bought for, so it projects nothing and the organization keeps the
 * free tier rather than a paid licence with no horizon.
 */
export function licenceRowFor(input: LicenceRowInput): LicenceRow {
  const subscription = input.subscription;
  const paid =
    subscription !== null &&
    input.entitlement.tier !== FREE_TIER &&
    subscription.periodEnd !== null;
  return paid && subscription !== null
    ? paidLicenceRow(subscription, input.entitlement, input.free)
    : freeLicenceRow(input.organizationId, input.free, input.now);
}

/** Where a licence row goes. One implementation today: Postgres. */
export interface LicenceRows {
  upsert: (row: LicenceRow) => Promise<void>;
  /**
   * Records the Stripe universe the subscription row was written in, so the entitlement
   * read can refuse a row the current mode cannot bill. Optional because a store that
   * only holds licences has nothing to stamp and every row then reads as unknown.
   */
  stampMode?: (organizationId: string, mode: string) => Promise<void>;
}

/**
 * The write, in one statement.
 *
 * `ON CONFLICT ... DO UPDATE` rather than the trigger's `DO NOTHING`, and the difference
 * is the point: the trigger writes a default and must never overwrite a paid row, while
 * this write *is* the paid row and has to be able to replace the default — and to put the
 * default back when the plan lapses. `recorded_at` moves with it, so the row says when
 * the deployment last confirmed it.
 */
export const UPSERT_LICENCE_SQL = `
  INSERT INTO organization_licences (
    organization_id, licence_id, tier, workspaces, seats,
    document_bytes, attachment_bytes, expires_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (organization_id) DO UPDATE
    SET licence_id = EXCLUDED.licence_id,
        tier = EXCLUDED.tier,
        workspaces = EXCLUDED.workspaces,
        seats = EXCLUDED.seats,
        document_bytes = EXCLUDED.document_bytes,
        attachment_bytes = EXCLUDED.attachment_bytes,
        expires_at = EXCLUDED.expires_at,
        recorded_at = now()
`;

/**
 * Writes the universe beside the subscription, so a later mode switch has something to
 * compare. The plugin's own writes to the row do not name this column, so a stamp
 * survives them; a plugin that later starts naming it would need this statement revisited.
 */
export const STAMP_SUBSCRIPTION_MODE_SQL = `
  UPDATE "subscription"
     SET "billing_mode" = $2
   WHERE "referenceId" = $1
`;

/** The statement's parameters, in the order {@link UPSERT_LICENCE_SQL} binds them. */
export function licenceRowValues(row: LicenceRow): readonly unknown[] {
  return [
    row.organizationId,
    row.licenceId,
    row.tier,
    row.workspaces,
    row.seats,
    row.documentBytes,
    row.attachmentBytes,
    new Date(row.expiresAt),
  ];
}

/** The write over any client that can answer one parameterised statement. */
export function postgresLicenceRows(query: Queryable): LicenceRows {
  return {
    upsert: async (row) => {
      await query.query(UPSERT_LICENCE_SQL, licenceRowValues(row));
    },
    stampMode: async (organizationId, mode) => {
      await query.query(STAMP_SUBSCRIPTION_MODE_SQL, [organizationId, mode]);
    },
  };
}

/** What a caller can ask the projection for. */
export interface LicenceProjection {
  /** Replace the organization's licence with what this subscription state buys. */
  project: (subscription: SubscriptionView) => Promise<LicenceRow>;
  /** Put the free row back: cancelled, paused, unpaid, past its period, or never paid. */
  release: (organizationId: string) => Promise<LicenceRow>;
  /** The row {@link project} or {@link release} would write, without writing it. */
  rowFor: (organizationId: string, subscription: SubscriptionView | null) => LicenceRow;
}

export interface LicenceProjectionDeps {
  rows: LicenceRows;
  /** The same table the token is minted from, so the two cannot name different limits. */
  tiers: TierTable;
  free: FreeLicenceTier;
  now?: () => number;
  /**
   * Called when the write fails.
   *
   * The plugin runs its lifecycle hooks inside a `try` that logs and lets the webhook
   * answer 200, so a projection that threw would be a log line nobody reads. Reporting
   * it here puts the failure in the deployment's own log, and the next lifecycle event
   * repairs the row.
   */
  onError?: (error: unknown, context: { organizationId: string }) => void;
  /**
   * The mode this process sells in, stamped beside every licence it projects.
   *
   * Absent means the store records no universe, and every row then reads as unknown,
   * which the entitlement read honours. A test subscription granting live sync is what
   * the stamp exists to stop, and it is stamped from the event's own universe: the
   * webhook that delivered it was signed by the active one.
   */
  billingMode?: string | null;
}

/**
 * Binds the table, the free tier and the write into the projection the plugin calls.
 *
 * Every hook goes through here, so `active`, `trialing`, `past_due`, `canceled` and "no
 * subscription" cannot each get their own rule: there is one row per state, decided by
 * {@link licenceRowFor} from the entitlement read's own answer.
 */
export function createLicenceProjection(deps: LicenceProjectionDeps): LicenceProjection {
  const now = deps.now ?? Date.now;

  const rowFor = (organizationId: string, subscription: SubscriptionView | null): LicenceRow =>
    licenceRowFor({
      organizationId,
      subscription,
      entitlement: entitlementFor(subscription, deps.tiers, now()),
      free: deps.free,
      now: now(),
    });

  const write = async (row: LicenceRow): Promise<LicenceRow> => {
    try {
      await deps.rows.upsert(row);
    } catch (error) {
      deps.onError?.(error, { organizationId: row.organizationId });
    }
    return row;
  };

  /**
   * Stamps the universe on the subscription row, after the licence it just wrote.
   *
   * Not part of {@link write} because only a subscription has a universe: a released
   * licence belongs to an organization whose row is stale or gone, and stamping that row
   * would claim a mode for a subscription nobody is paying for.
   */
  const stamp = async (organizationId: string): Promise<void> => {
    const mode = deps.billingMode;
    if (mode === undefined || mode === null || deps.rows.stampMode === undefined) return;
    try {
      await deps.rows.stampMode(organizationId, mode);
    } catch (error) {
      deps.onError?.(error, { organizationId });
    }
  };

  return {
    rowFor,
    project: async (subscription) => {
      const row = await write(rowFor(subscription.organizationId, subscription));
      await stamp(subscription.organizationId);
      return row;
    },
    release: async (organizationId) => write(rowFor(organizationId, null)),
  };
}
