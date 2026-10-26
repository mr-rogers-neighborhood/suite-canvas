import { describe, expect, it } from "vitest";
import { MFA_COPY, mfaAdvice, type SignInMethod } from "./mfa.js";

/**
 * The second-factor policy (ADR-0067 §11).
 *
 * What is worth pinning is the axis: advice follows the *method*, and requirement follows
 * *capability*. A role-based rule would push a prompt at a passkey user who gains nothing
 * from it while leaving an email-only account — the one that actually needs it — at
 * "optional".
 */

const methods: SignInMethod[] = ["passkey", "magic-link", "google", "password"];

describe("second-factor advice", () => {
  it("recommends a factor for the methods whose only key is one secret", () => {
    expect(mfaAdvice({ method: "magic-link", canImpersonateOrSpend: false })).toBe("recommended");
    // A password is the one credential here that can be guessed as well as stolen,
    // and it exists only because an invitation created it (ADR-0067 §11 amendment).
    expect(mfaAdvice({ method: "password", canImpersonateOrSpend: false })).toBe("recommended");
    expect(MFA_COPY.recommended).toMatch(/password/u);
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
