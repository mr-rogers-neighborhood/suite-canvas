import { describe, expect, it } from "vitest";
import { MFA_COPY, mfaAdvice, type SignInMethod } from "./mfa.js";

/**
 * The second-factor policy ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §11).
 *
 * What is worth pinning is the axis: advice follows the *method*, and requirement follows
 * *capability*. A role-based rule would push a prompt at a passkey user who gains nothing
 * from it while leaving an email-only account — the one that actually needs it — at
 * "optional".
 */

const methods: SignInMethod[] = ["passkey", "magic-link", "google"];

describe("second-factor advice", () => {
  it("recommends a factor for the method whose only key is an inbox", () => {
    expect(mfaAdvice({ method: "magic-link", canImpersonateOrSpend: false })).toBe("recommended");
    expect(MFA_COPY.recommended).toContain("inbox");
  });

  it("does not nag a passkey or Google account, because they already have one", () => {
    expect(mfaAdvice({ method: "passkey", canImpersonateOrSpend: false })).toBe("optional");
    expect(mfaAdvice({ method: "google", canImpersonateOrSpend: false })).toBe("optional");
  });

  it("requires a factor from anyone who can act as someone else or spend", () => {
    for (const method of methods) {
      expect(mfaAdvice({ method, canImpersonateOrSpend: true })).toBe("required");
    }
  });

  it("gives every answer a sentence, so the panel never renders an empty prompt", () => {
    for (const advice of ["required", "recommended", "optional"] as const) {
      expect(MFA_COPY[advice].length).toBeGreaterThan(20);
    }
  });
});
