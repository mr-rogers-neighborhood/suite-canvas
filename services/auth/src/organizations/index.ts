/**
 * Organizations: the tenant a workspace belongs to, the claim that gives it an owner,
 * and the seat/workspace allowances a licence puts on it.
 *
 * A workspace is a document id and nothing here has ever seen the document: the control
 * plane stores rows about ownership, never the work itself.
 */
export {
  FREE_LICENCE_TIER,
  type FreeLicenceTier,
  freeSeatLicence,
} from "./freeTier.js";
export {
  canAddWorkspace,
  checkSeat,
  checkSeatAllowance,
  checkWorkspaceAllowance,
  seatCeiling,
  seatLicence,
  seatProblemMessage,
} from "./seats.js";
export { CLAIM_WORKSPACE_SQL, claimWorkspace, validateWorkspaceIdentity } from "./workspaces.js";
