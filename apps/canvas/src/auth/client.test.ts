import { describe, expect, it } from "vitest";
import { accountBaseFor } from "./client";

/**
 * The account client is constructed at import time, so a base it refuses does
 * not fail one screen: it throws before the app can render any of them. The
 * desktop shell is an `app://` origin with no account surface, which is exactly
 * the case that took the launcher down.
 */
describe("accountBaseFor", () => {
  it("uses the page's own origin when it can carry a cookie", () => {
    expect(accountBaseFor("https://app.suite.run", "/api/auth")).toBe(
      "https://app.suite.run/api/auth",
    );
    expect(accountBaseFor("http://localhost:5173", "/api/auth")).toBe(
      "http://localhost:5173/api/auth",
    );
  });

  it("gives an origin that cannot carry one a valid but unreachable base", () => {
    expect(accountBaseFor("app://canvas", "/api/auth")).toBe("http://localhost.invalid/api/auth");
    expect(accountBaseFor("file://", "/api/auth")).toBe("http://localhost.invalid/api/auth");
  });

  it("leaves an absolute base alone", () => {
    expect(accountBaseFor("app://canvas", "https://accounts.example/api/auth")).toBe(
      "https://accounts.example/api/auth",
    );
  });
});
