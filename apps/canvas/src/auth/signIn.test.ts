import { describe, expect, it } from "vitest";
import {
  emailProblem,
  LAST_LOGIN_METHOD_COOKIE,
  readLastLoginMethod,
  signInOffers,
} from "./signIn";

describe("last login method", () => {
  it("reads the method the server plugin recorded", () => {
    expect(readLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=passkey`)).toBe("passkey");
    expect(readLastLoginMethod(`other=1; ${LAST_LOGIN_METHOD_COOKIE}=magic-link; third=2`)).toBe(
      "magic-link",
    );
    expect(readLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=google`)).toBe("google");
  });

  it("is null rather than wrong for a missing, empty or unknown cookie", () => {
    expect(readLastLoginMethod(null)).toBeNull();
    expect(readLastLoginMethod("")).toBeNull();
    expect(readLastLoginMethod("other=1")).toBeNull();
    expect(readLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=`)).toBeNull();
    // A method we do not offer must not become a button.
    expect(readLastLoginMethod(`${LAST_LOGIN_METHOD_COOKIE}=email`)).toBeNull();
  });
});

describe("sign-in offers", () => {
  it("leads with the method that worked last", () => {
    expect(signInOffers("passkey").map((offer) => offer.method)).toEqual([
      "passkey",
      "magic-link",
      "google",
    ]);
    expect(signInOffers("google").map((offer) => offer.method)).toEqual([
      "google",
      "passkey",
      "magic-link",
    ]);
  });

  it("says 'continue with' only for the remembered method", () => {
    const offers = signInOffers("magic-link");
    expect(offers[0]?.label).toBe("Continue with a magic link");
    expect(offers[0]?.recent).toBe(true);
    expect(offers.slice(1).every((offer) => !offer.recent)).toBe(true);
    expect(offers.map((offer) => offer.label)).toEqual([
      "Continue with a magic link",
      "Use a passkey",
      "Continue with Google",
    ]);
  });

  it("offers the same three methods, in a stable order, on a first visit", () => {
    const offers = signInOffers(null);
    expect(offers.map((offer) => offer.method)).toEqual(["passkey", "magic-link", "google"]);
    expect(offers.some((offer) => offer.recent)).toBe(false);
  });
});

describe("email problem", () => {
  it("lets the server be the authority on what a legal address is", () => {
    expect(emailProblem("reader@example.com")).toBeNull();
    expect(emailProblem("  reader@example.com  ")).toBeNull();
    expect(emailProblem("")).toContain("Enter the address");
    expect(emailProblem("reader")).toContain("does not look like");
    expect(emailProblem("@example.com")).toContain("does not look like");
    expect(emailProblem("reader@")).toContain("does not look like");
  });
});
