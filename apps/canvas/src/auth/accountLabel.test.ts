import { describe, expect, it } from "vitest";
import { accountLabel, isPlaceholderEmail } from "./accountLabel";

const PLACEHOLDER = "amtzlga0jmzd9omq6itlpb9mudjkvrrj@anonymous.placeholder.invalid";

describe("what an account is called on screen", () => {
  it("never shows the address an anonymous session was minted with", () => {
    // The bug: the chip read `email` first, so a generated address became the reader's
    // name in the app bar.
    expect(accountLabel({ name: null, email: PLACEHOLDER })).toBe("Anonymous");
    expect(accountLabel({ name: "  ", email: PLACEHOLDER })).toBe("Anonymous");
    expect(isPlaceholderEmail(PLACEHOLDER)).toBe(true);
  });

  it("prefers the name, because that is what a person chose", () => {
    expect(accountLabel({ name: "Ada", email: "ada@example.com" })).toBe("Ada");
    expect(accountLabel({ name: "Ada", email: PLACEHOLDER })).toBe("Ada");
  });

  it("falls back to an address a person could recognise", () => {
    expect(accountLabel({ name: null, email: "ada@example.com" })).toBe("ada@example.com");
  });

  it("says something when there is nothing to say", () => {
    expect(accountLabel(null)).toBe("Anonymous");
    expect(accountLabel({ name: null, email: null })).toBe("Anonymous");
    expect(accountLabel(undefined, "Account")).toBe("Account");
  });

  it("matches the placeholder domain whatever its casing", () => {
    expect(isPlaceholderEmail("abc@ANONYMOUS.PLACEHOLDER.INVALID")).toBe(true);
    expect(isPlaceholderEmail("someone@placeholder.invalid.example.com")).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });
});
