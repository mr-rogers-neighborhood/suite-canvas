/**
 * `@suite/billing` — Stripe through the auth plugin, plus the entitlement read.
 *
 * Two callers and two exports for them. `services/auth` builds its Better Auth instance
 * with `createBillingPlugin`, which registers checkout, the portal and the webhook under
 * `/api/auth/*`. `apps/control-plane` mounts the module that answers `POST /api/billing/*`
 * and reads an organization's tier through `createEntitlementReader`.
 *
 * There is no webhook handler, checkout call, event claim or subscription store here:
 * the plugin owns that state and its table. What lives in this package is the tier table,
 * the two functions that turn a row into limits, and the projection that writes the same
 * answer into `organization_licences` so the seat check and the token agree.
 */

export {
  createEntitlementReader,
  type Entitlement,
  type EntitlementReaderDeps,
  entitlementFor,
  FREE_TIER,
  freeEntitlement,
  type OrganizationEntitlements,
  type OrganizationSubscriptions,
  type SubscriptionRow,
} from "./entitlement/entitlement.ts";
export {
  createPostgresSubscriptions,
  LIVE_SUBSCRIPTION_SQL,
  type PostgresSubscriptions,
  postgresSubscriptions,
  type Queryable,
  subscriptionRowOf,
} from "./entitlement/postgres.ts";
export { BillingError, type BillingFailure, billingFailureOf } from "./errors.ts";
export { MAX_BODY_BYTES, readJsonBody, sendJson, statusOf } from "./http/json.ts";
export {
  createLicenceProjection,
  type FreeLicenceTier,
  freeLicenceRow,
  type LicenceProjection,
  type LicenceProjectionDeps,
  type LicenceRow,
  type LicenceRowInput,
  type LicenceRows,
  licenceRowFor,
  licenceRowValues,
  type PluginSubscription,
  postgresLicenceRows,
  type SubscriptionView,
  subscriptionViewOf,
  UPSERT_LICENCE_SQL,
} from "./licence/projection.ts";
export {
  type AuthorizeOrganizationInput,
  type BillingPluginDeps,
  billingPluginOptions,
  createBillingPlugin,
  planList,
} from "./stripe/plugin.ts";
export {
  limitsOf,
  parseTierTable,
  SEATS_PER_PLAN,
  type TierPlan,
  type TierTable,
  tierTableByTier,
} from "./stripe/tiers.ts";
