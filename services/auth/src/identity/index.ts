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
export { MFA_COPY, type MfaAdvice, mfaAdvice, type SignInMethod } from "./mfa.js";
export { principalPrecedence, resolvePrincipal } from "./principal.js";
