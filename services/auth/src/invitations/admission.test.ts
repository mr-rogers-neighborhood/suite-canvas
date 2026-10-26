import { describe, expect, it } from "vitest";
import {
  ADMISSION_PENDING_MESSAGE,
  admissionRequired,
  admitted,
  isAdmissionGatedPath,
} from "./admission.js";

/**
 * Admission (ADR-0067 §7).
 *
 * The gate decides two things that are easy to get wrong in opposite directions: it
 * must be *off* unless a deployment asks for it, and when it is on it must refuse a
 * short, literal list — because refusing too much turns a waitlist into a sign-in
 * loop, and refusing nothing turns one into a lie.
 */

describe("the admission flag", () => {
  it("is off unless a deployment spells it out", () => {
    for (const value of [undefined, "", "0", "false", "no", "off"]) {
      expect(admissionRequired({ SUITE_ADMISSION_REQUIRED: value })).toBe(false);
    }
  });

  it("opens for the two spellings an operator types on purpose", () => {
    expect(admissionRequired({ SUITE_ADMISSION_REQUIRED: "1" })).toBe(true);
    expect(admissionRequired({ SUITE_ADMISSION_REQUIRED: " TRUE " })).toBe(true);
  });
});

describe("whether an account is admitted", () => {
  it("admits everyone when the deployment has no queue", () => {
    // A self-host with one user must never meet a queue it did not ask for, and
    // turning the flag off must not need a migration.
    expect(admitted({ admittedAt: null }, false)).toBe(true);
    expect(admitted(undefined, false)).toBe(true);
  });

  it("holds an account with no stamp when the queue is on", () => {
    expect(admitted({ admittedAt: null }, true)).toBe(false);
    expect(admitted({}, true)).toBe(false);
    expect(admitted(null, true)).toBe(false);
  });

  it("admits a stamped account, and treats a nonsense stamp as no stamp", () => {
    expect(admitted({ admittedAt: 1_760_000_000_000 }, true)).toBe(true);
    // Fails closed: a zero, a NaN or a string is not a timestamp an operator wrote.
    expect(admitted({ admittedAt: 0 }, true)).toBe(false);
    expect(admitted({ admittedAt: Number.NaN }, true)).toBe(false);
    expect(admitted({ admittedAt: "yes" as unknown as number }, true)).toBe(false);
  });
});

describe("what the gate refuses", () => {
  it("refuses creating an organization, and nothing else yet", () => {
    expect(isAdmissionGatedPath("/organization/create")).toBe(true);
    // Not gated: a held reader must be able to sign in, look around and leave.
    for (const path of [
      "/sign-in/magic-link",
      "/get-session",
      "/sign-out",
      "/organization/list",
      "/organization/accept-invitation",
    ]) {
      expect(isAdmissionGatedPath(path)).toBe(false);
    }
  });

  it("says the same sentence everywhere, so the queue has one voice", () => {
    expect(ADMISSION_PENDING_MESSAGE).toBe(
      "You're on the list. We'll email you when your workspace is ready.",
    );
  });
});
