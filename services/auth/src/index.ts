/**
 * `@suite/auth` — the control plane for owned workspaces.
 *
 * The exports are grouped by what a caller is doing, because three different
 * callers exist and each should reach for a different one:
 *
 * - the relay (`apps/collab-server`) uses `checkSeat` and `resolvePrincipal`;
 * - the HTTP routes use the domain functions in `workspaces.ts` /`invites.ts`;
 * - tests and local development use `memoryControlPlane`.
 *
 * `betterAuth.ts` is the only module that knows Better Auth exists.
 */

export {
  ADMISSION_PENDING_CODE,
  ADMISSION_PENDING_MESSAGE,
  admissionRequired,
  admitted,
  isAdmissionGatedPath,
} from "./admission.js";
export {
  type AdoptionInput,
  type AdoptionOutcome,
  type AdoptionStore,
  adoptAnonymousOrganizations,
} from "./adoption.js";
export {
  capabilitiesForPrincipal,
  capabilitiesForRole,
  type WorkspaceCapabilities,
} from "./capabilities.js";
export { type AuthEntry, type AuthEntryDeps, createAuthEntry } from "./entry.js";
export { authConfigProblems, authEnabled, authEnvironment, googleConfigured } from "./env.js";
export { AuthError, type AuthErrorCode, authErrorCodes, isAuthError } from "./errors.js";
export {
  type AuthHandlerDeps,
  type AuthHttpEvent,
  type AuthHttpResponse,
  createAuthHandler,
} from "./handler.js";
export { createInviteKey, redeemInviteKey, revokeInviteKey } from "./invites.js";
export { generateInviteKey, hashInviteKey, looksLikeInviteKey } from "./keys.js";
export { type LicenceStore, licenceStateFor, type MembershipReader } from "./licences.js";
export { memoryControlPlane } from "./memory.js";
export { MFA_COPY, type MfaAdvice, mfaAdvice, type SignInMethod } from "./mfa.js";
export { databaseUrlProblem, postgresDatabase, type Queryable } from "./postgres.js";
export {
  postgresLicences,
  postgresMemberships,
  postgresRepositories,
  postgresWorkspaces,
} from "./postgresRepositories.js";
export { principalPrecedence, resolvePrincipal } from "./principal.js";
export {
  canAddWorkspace,
  checkSeat,
  checkSeatAllowance,
  checkWorkspaceAllowance,
  seatLicence,
  seatProblemMessage,
} from "./seats.js";
export type {
  AccountSession,
  AuthEnvironment,
  InviteKeyRecord,
  LicenceClaims,
  MemberRecord,
  OrganizationRole,
  Principal,
  SeatLicence,
  WorkspaceRecord,
} from "./types.js";
export { CLAIM_WORKSPACE_SQL, claimWorkspace, validateWorkspaceIdentity } from "./workspaces.js";
