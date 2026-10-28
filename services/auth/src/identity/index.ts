/**
 * Identity: who a request is, and what their role may do.
 *
 * `betterAuth.ts` is the only module in the package that knows Better Auth exists;
 * it is imported directly by `http/entry.ts` rather than through this surface,
 * because constructing the instance is a deployment concern and not something a
 * caller of `@suite/auth` should reach for.
 */
export {
  capabilitiesForPrincipal,
  capabilitiesForRole,
  type WorkspaceCapabilities,
} from "./capabilities.js";
export {
  MFA_ALLOWED_PATHS,
  MFA_COPY,
  MFA_ENROLL_PATH,
  MFA_ENROLLMENT_CODE,
  type MfaAdvice,
  type MfaEnrollment,
  type MfaRefusal,
  mfaAdvice,
  mfaEnrollment,
  mfaExemptPath,
  mfaGate,
  rolesOf,
  type SignInMethod,
  secondFactorRequired,
} from "./mfa.js";
export { principalPrecedence, resolvePrincipal } from "./principal.js";
export {
  RELAY_TOKEN_TTL,
  RELAY_TOKEN_TTL_SECONDS,
  type RelayClaimInput,
  type RelayClaims,
  relayClaims,
} from "./relayToken.js";
export { type RoleOverrideLookup, withRoleOverride } from "./roleOverride.js";
