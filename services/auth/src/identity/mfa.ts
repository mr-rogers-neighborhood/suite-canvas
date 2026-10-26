/**
 * How hard to push a second factor
 * (ADR-0067 §11).
 *
 * The first cut scoped two-factor by *role* — operators and owners — which mistook a
 * role for a risk model. The risk follows the **sign-in method**, because what a second
 * factor protects is the thing that can be stolen:
 *
 * - a **passkey** is already two factors (device possession plus a biometric or PIN), so
 *   a code adds little — except against *synced* passkeys, where one compromised cloud
 *   account yields the key. That gap makes it worth offering, not worth demanding;
 * - a **magic link** is one factor and **the mailbox is the entire account**. There is no
 *   password to reset, so the link *is* the reset path: an attacker with the mailbox
 *   takes the account unless something stands in front of sign-in;
 * - a **password** is one factor and the only *guessable* one. It is reachable only by
 *   redeeming an invitation (§11 amendment), but once an account has one it is a secret
 *   a person can repeat elsewhere, phish or brute-force — so it earns the same advice a
 *   magic link does, and the rate limiter stands in front of the route as well;
 * - **Google** brings its own MFA, so ours would be a second lock on a door we did not fit.
 *
 * Requirement is scoped to the one capability that can do damage *inside* the product —
 * impersonation and spending an organization's money — never to a judgement about how
 * careful we think a person is.
 */

import { err, ok, type Result } from "neverthrow";

export type SignInMethod = "passkey" | "magic-link" | "google" | "password";

export type MfaAdvice = "required" | "recommended" | "optional";

export interface MfaInput {
  /** The method this account actually signs in with, as `lastLoginMethod` reports it. */
  method: SignInMethod;
  /** True for an operator (can impersonate) or an owner/admin who can bill. */
  canImpersonateOrSpend: boolean;
}

export function mfaAdvice(input: MfaInput): MfaAdvice {
  // Capability first: someone who can act as another person, or spend the
  // organization's money, needs a second factor whatever their door is.
  if (input.canImpersonateOrSpend) return "required";

  switch (input.method) {
    case "magic-link":
      // The methods where the second factor protects against the realistic attack:
      // someone else reading the inbox, or guessing and replaying a password.
      return "recommended";
    case "password":
      return "recommended";
    case "passkey":
    case "google":
      return "optional";
  }
}

/** The one sentence the Security panel shows for each answer. */
export const MFA_COPY: Record<MfaAdvice, string> = {
  required:
    "Add a second factor. This account can manage people and billing, so one secret is not enough.",
  recommended:
    "You sign in with an email link or a password, so one secret opens this account. Add a second factor.",
  optional: "You can add a second factor to this account.",
};

/**
 * Enforcement, as opposed to advice.
 *
 * Advice above is a nudge on the sign-in screen; this is the part that refuses. One
 * role is held to it: `admin` is the operator role the `admin` plugin defines, and
 * the same role can ban, impersonate and read every account in the deployment. An
 * account with that power and one secret is a single phished password away from the
 * whole control plane, so the second factor is a condition of using it rather than a
 * suggestion shown once and dismissed.
 *
 * `owner` is deliberately not here. An owner holds one tenant's licence and can bill;
 * that is money, and `mfaAdvice` already marks it required, but ranking it beside the
 * role that can impersonate anyone would blur two different blast radii.
 */

/** The endpoint that starts enrolment, as the client calls it behind `/api/auth`. */
export const MFA_ENROLL_PATH = "/two-factor/enable";

/** The refusal code, so the client can open enrolment instead of showing "forbidden". */
export const MFA_ENROLLMENT_CODE = "mfa-enrollment-required";

/**
 * Paths an admin without a second factor may still reach.
 *
 * Without these the requirement would be a locked door with the key behind it: the
 * only way to satisfy it is `/two-factor/enable`, and the only way to confirm the
 * authenticator app is `/two-factor/verify-totp`. Session reads and sign-out are here
 * so the client can ask "what do I still need?" and so a person can leave.
 */
export const MFA_ALLOWED_PATHS: readonly string[] = [
  "/get-session",
  "/sign-out",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/update-user",
];

/** `user.role` is one comma-separated string; the admin plugin writes it that way. */
export function rolesOf(role: string | null | undefined): string[] {
  return (role ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Does this role set carry the capability that requires a second factor? */
export function secondFactorRequired(role: string | null | undefined): boolean {
  return rolesOf(role).includes("admin");
}

/**
 * What the client needs in order to enrol: whether it must, whether it has, and the
 * endpoint that starts it.
 *
 * `enrolled` reads `twoFactorEnabled`, which the plugin writes when the first
 * authenticator is confirmed — not when enrolment *starts*, so a half-finished setup
 * does not count as a factor.
 */
export interface MfaEnrollment {
  required: boolean;
  enrolled: boolean;
  enrollAt: string;
}

export interface MfaUser {
  role?: string | null | undefined;
  twoFactorEnabled?: boolean | null | undefined;
}

export function mfaEnrollment(user: MfaUser | null | undefined): MfaEnrollment {
  return {
    required: secondFactorRequired(user?.role),
    enrolled: user?.twoFactorEnabled === true,
    enrollAt: MFA_ENROLL_PATH,
  };
}

export interface MfaRefusal {
  readonly code: typeof MFA_ENROLLMENT_CODE;
  readonly message: string;
  /** Where to go next, carried in the refusal so the client does not hardcode it. */
  readonly enrollAt: string;
}

/** Paths the gate itself must not block, or enrolment would be impossible. */
export function mfaExemptPath(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  if (bare === "/two-factor" || bare.startsWith("/two-factor/")) return true;
  return MFA_ALLOWED_PATHS.includes(bare);
}

/**
 * May this session use this path?
 *
 * No session is allowed: a request that has not signed in yet is not an admin
 * skipping enrolment, and refusing it here would break sign-in itself.
 */
export function mfaGate(user: MfaUser | null | undefined, path: string): Result<"ok", MfaRefusal> {
  const enrollment = mfaEnrollment(user);
  if (!enrollment.required || enrollment.enrolled) return ok("ok");
  if (mfaExemptPath(path)) return ok("ok");
  return err({
    code: MFA_ENROLLMENT_CODE,
    message:
      "This account can manage people, so it needs a second factor before it can do anything else.",
    enrollAt: enrollment.enrollAt,
  });
}
