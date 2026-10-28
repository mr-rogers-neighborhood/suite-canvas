import { afterEach, describe, expect, it } from "vitest";
import { ANONYMOUS_NAME, getOrCreateIdentity } from "./identity";

const KEY = "suite.identity";

describe("getOrCreateIdentity", () => {
  afterEach(() => localStorage.removeItem(KEY));

  it("should call an unidentified person Anonymous", () => {
    expect(getOrCreateIdentity().name).toBe(ANONYMOUS_NAME);
  });

  it("should keep one colour per browser", () => {
    const first = getOrCreateIdentity();
    expect(getOrCreateIdentity().color).toBe(first.color);
  });

  it("should keep a stored colour but drop a generated nickname", () => {
    // Identities written before the change carry "Nova-347"; the colour is what
    // tells two cursors apart, so it survives and the invented word does not.
    localStorage.setItem(KEY, JSON.stringify({ name: "Nova-347", color: "#f97316" }));
    const identity = getOrCreateIdentity();
    expect(identity).toEqual({ name: ANONYMOUS_NAME, color: "#f97316" });
  });

  it("should replace a stored identity that makes no sense", () => {
    localStorage.setItem(KEY, "{}");
    expect(getOrCreateIdentity().name).toBe(ANONYMOUS_NAME);
  });
});
