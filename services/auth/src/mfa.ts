/**
 * How hard to push a second factor
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §11).
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
 * - **Google** brings its own MFA, so ours would be a second lock on a door we did not fit.
 *
 * Requirement is scoped to the one capability that can do damage *inside* the product —
 * impersonation and spending an organization's money — never to a judgement about how
 * careful we think a person is.
 */

export type SignInMethod = "passkey" | "magic-link" | "google";

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
      // The only method where the second factor protects against the realistic
      // attack: someone else reading the inbox.
      return "recommended";
    case "passkey":
    case "google":
      return "optional";
  }
}

/** The one sentence the Security panel shows for each answer. */
export const MFA_COPY: Record<MfaAdvice, string> = {
  required:
    "Add a second factor. This account can manage people and billing, so a password alone is not enough.",
  recommended:
    "You sign in by email, so anyone who can read that inbox can open your account. Add a second factor.",
  optional: "You can add a second factor to this account.",
};
