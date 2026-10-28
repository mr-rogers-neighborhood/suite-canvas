import { describe, expect, it } from "vitest";
import { authEnvironment } from "./env.js";

/**
 * The whitelist is the contract.
 *
 * `betterAuth.ts` reads `SUITE_ADMIN_EMAILS` off `AuthEnvironment`, so a variable that
 * is missing from this function is not a validation failure: it is a value the
 * deployment set and the process never saw. The symptom is a minted `operator: false`
 * and a `401` from the operator routes, which reads like a session problem and sends
 * whoever is debugging it in the wrong direction. Every variable the auth instance
 * reads has to pass through here.
 */
describe("authEnvironment", () => {
  it("passes the operator list through", () => {
    const env = authEnvironment({ SUITE_ADMIN_EMAILS: "ops@example.com, second@example.com" });

    expect(env.SUITE_ADMIN_EMAILS).toBe("ops@example.com, second@example.com");
  });

  it("leaves the operator list undefined rather than inventing one", () => {
    // Unset means nobody is an operator, which is the safe default and the answer a
    // self-host expects.
    expect(authEnvironment({}).SUITE_ADMIN_EMAILS).toBeUndefined();
  });

  it("keeps the service closed by default", () => {
    expect(authEnvironment({}).SUITE_AUTH_ENABLED).toBe("0");
  });
});
