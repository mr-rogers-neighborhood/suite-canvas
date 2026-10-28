import { filter, isNonNullish } from "remeda";
import type { AuthEnvironment, OrganizationRole } from "../types.js";

/**
 * Every `SUITE_*` variable the account service reads, in one place, so a
 * deployment can be checked by reading one function. The defaulted values are
 * the closed ones: the service is off, and nothing else matters until
 * `SUITE_AUTH_ENABLED=1`.
 */
export function authEnvironment(
  source: Record<string, string | undefined> = process.env,
): AuthEnvironment {
  return {
    SUITE_AUTH_ENABLED: source.SUITE_AUTH_ENABLED ?? "0",
    SUITE_AUTH_SECRET: source.SUITE_AUTH_SECRET,
    SUITE_AUTH_URL: source.SUITE_AUTH_URL,
    SUITE_AUTH_DATABASE_URL: source.SUITE_AUTH_DATABASE_URL,
    SUITE_GOOGLE_CLIENT_ID: source.SUITE_GOOGLE_CLIENT_ID,
    SUITE_GOOGLE_CLIENT_SECRET: source.SUITE_GOOGLE_CLIENT_SECRET,
    SUITE_AUTH_RP_ID: source.SUITE_AUTH_RP_ID,
    SUITE_AUTH_RP_NAME: source.SUITE_AUTH_RP_NAME,
    SUITE_AUTH_MAX_ORGS_PER_USER: source.SUITE_AUTH_MAX_ORGS_PER_USER,
    // The operator list. Missing from this whitelist would be worse than a wrong
    // value: the deployment would name an operator, mint `operator: false` anyway,
    // and the only symptom would be a 401 that looks like a session problem.
    SUITE_ADMIN_EMAILS: source.SUITE_ADMIN_EMAILS,
    SUITE_TURNSTILE_SECRET: source.SUITE_TURNSTILE_SECRET,
    SUITE_AUTH_REQUIRE_VERIFICATION: source.SUITE_AUTH_REQUIRE_VERIFICATION,
    SUITE_ADMISSION_REQUIRED: source.SUITE_ADMISSION_REQUIRED,
  };
}

/**
 * Closed by default. `1` and `true` are the only two spellings an operator types
 * on purpose, matching `SUITE_BILLING_ENABLED` so the two switches behave the
 * same way in the same deployment.
 */
export function authEnabled(env: AuthEnvironment): boolean {
  const raw = env.SUITE_AUTH_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export interface AuthConfigProblem {
  variable: string;
  problem: string;
}

/** Better Auth's own minimum; a shorter secret is refused rather than padded. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Everything that must be present before a session can be verified. Returned as
 * a list rather than throwing, so a startup check can print all of it at once —
 * the relay's `config.ts` does the same for its own variables.
 */
export function authConfigProblems(env: AuthEnvironment): AuthConfigProblem[] {
  const secret = env.SUITE_AUTH_SECRET?.trim() ?? "";
  const url = env.SUITE_AUTH_URL?.trim() ?? "";
  const googleId = env.SUITE_GOOGLE_CLIENT_ID?.trim() ?? "";
  const googleSecret = env.SUITE_GOOGLE_CLIENT_SECRET?.trim() ?? "";
  // One half of the Google pair is worse than neither: a sign-in button that cannot
  // work is a broken deployment, not a missing feature.
  const googleHalfConfigured = (googleId.length === 0) !== (googleSecret.length === 0);
  // Each problem is a value or nothing, in the order an operator reads them; the
  // array is the whole answer rather than something assembled by pushing.
  return filter(
    [
      secret.length < MIN_SECRET_LENGTH
        ? {
            variable: "SUITE_AUTH_SECRET",
            problem: `must be at least ${MIN_SECRET_LENGTH} characters`,
          }
        : null,
      url.length === 0
        ? { variable: "SUITE_AUTH_URL", problem: "is required for cookie scoping" }
        : null,
      googleHalfConfigured
        ? {
            variable: "SUITE_GOOGLE_CLIENT_ID",
            problem: "and SUITE_GOOGLE_CLIENT_SECRET must be set together or not at all",
          }
        : null,
    ],
    isNonNullish,
  );
}

export function googleConfigured(env: AuthEnvironment): boolean {
  return (
    (env.SUITE_GOOGLE_CLIENT_ID?.trim() ?? "").length > 0 &&
    (env.SUITE_GOOGLE_CLIENT_SECRET?.trim() ?? "").length > 0
  );
}

/**
 * Organizations one account may own on this deployment.
 *
 * A licence is attached to an organization, so this is the tenant ceiling and
 * not a licence field: a second tenant needs a second subscription, and the
 * default of 1 makes the hosted default match the product's "one organization,
 * many workspaces" shape. Self-hosting raises it with one variable.
 */
export function maxOrganizationsPerUser(source: {
  SUITE_AUTH_MAX_ORGS_PER_USER: string | undefined;
}): number {
  const raw = source.SUITE_AUTH_MAX_ORGS_PER_USER?.trim();
  if (raw === undefined || raw.length === 0) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** The role list the control plane accepts, for a caller that has only a string. */
export function roleOrNull(value: unknown): OrganizationRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}
