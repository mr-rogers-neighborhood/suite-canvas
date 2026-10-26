/** Licensing: the licence a seat check reads, and the entitlements a token reports. */
export {
  type Entitlement,
  type EntitlementReader,
  FREE_TIER,
  freeEntitlement,
  noEntitlements,
} from "./entitlements.js";
export {
  type LicenceStore,
  licenceStateFor,
  type MembershipReader,
  UNPROVISIONED,
} from "./licences.js";
