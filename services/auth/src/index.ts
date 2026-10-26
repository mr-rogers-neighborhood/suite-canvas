/**
 * `@suite/auth` — the control plane for owned workspaces.
 *
 * The package is laid out by feature, and this file is the whole public surface: it
 * re-exports each folder's `index.ts` rather than reaching into its modules, so what a
 * caller may use is exactly what a folder publishes.
 *
 * Three different callers exist and each reaches for a different part:
 *
 * - the relay (`apps/collab-server`) uses `checkSeat` and `resolvePrincipal`;
 * - the HTTP routes use the domain functions in `organizations/` and the redemption
 *   port in `invitations/`;
 * - tests and local development use `memoryControlPlane`.
 *
 * `identity/betterAuth.ts` is the only module that knows Better Auth exists, and
 * nothing in the package can reach a document: there is no Loro dependency, no graph
 * dependency and no document store here.
 */

export {
  type AuthEntry,
  type AuthEntryDeps,
  AuthError,
  type AuthErrorCode,
  type AuthHandlerDeps,
  type AuthHttpEvent,
  type AuthHttpResponse,
  authConfigProblems,
  authEnabled,
  authEnvironment,
  authErrorCodes,
  createAuthEntry,
  createAuthHandler,
  googleConfigured,
  isAuthError,
} from "./http/index.js";
export {
  capabilitiesForPrincipal,
  capabilitiesForRole,
  MFA_COPY,
  type MfaAdvice,
  mfaAdvice,
  principalPrecedence,
  resolvePrincipal,
  type SignInMethod,
  type WorkspaceCapabilities,
} from "./identity/index.js";
export {
  ADMISSION_PENDING_CODE,
  ADMISSION_PENDING_MESSAGE,
  type AdmissionRefusal,
  admissionGate,
  admissionRequired,
  admitted,
  type EnrollmentOutcome,
  type EnrollmentRedeemInput,
  type EnrollmentRedemption,
  enrollmentOptions,
  enrollmentPlugin,
  enrollmentRedemption,
  type InvitationEmail,
  isAdmissionGatedPath,
  type RedemptionRefusal,
  redemptionResult,
} from "./invitations/index.js";
export { type LicenceStore, licenceStateFor, type MembershipReader } from "./licensing/index.js";
export {
  type AdoptionInput,
  type AdoptionOutcome,
  type AdoptionStore,
  adoptAnonymousOrganizations,
  CLAIM_WORKSPACE_SQL,
  canAddWorkspace,
  checkSeat,
  checkSeatAllowance,
  checkWorkspaceAllowance,
  claimWorkspace,
  seatCeiling,
  seatLicence,
  seatProblemMessage,
  validateWorkspaceIdentity,
} from "./organizations/index.js";
export {
  databaseUrlProblem,
  memoryControlPlane,
  postgresDatabase,
  postgresLicences,
  postgresMemberships,
  postgresRepositories,
  postgresWorkspaces,
  type Queryable,
} from "./store/index.js";
export type {
  AccountSession,
  AuthEnvironment,
  LicenceClaims,
  MemberRecord,
  OrganizationRole,
  Principal,
  SeatLicence,
  WorkspaceRecord,
} from "./types.js";
