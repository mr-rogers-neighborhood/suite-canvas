import { describe, expect, it } from "vitest";
import { type ErrorCode, errorCodes, formatMessage, isErrorCode, locales, messageFor } from ".";

describe("error codes", () => {
  it("should read as domain.subject.reason in lowercase", () => {
    for (const code of errorCodes) {
      expect(code, code).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2}$/);
    }
  });

  it("should be unique", () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });

  it("should narrow a string only when it is a shipped code", () => {
    expect(isErrorCode("peek.target.missing")).toBe(true);
    expect(isErrorCode("peek.target.gone")).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(7)).toBe(false);
  });

  it("should ship actions rather than an apology for every code", () => {
    for (const code of errorCodes) {
      const message = messageFor(code);
      expect(message, code).not.toBe(code);
      expect(message.length, code).toBeGreaterThan(24);
      expect(message.toLowerCase(), code).not.toContain("something went wrong");
    }
  });
});

describe("messageFor", () => {
  it("should return the catalogue sentence for a code", () => {
    expect(messageFor("annotation.source.missing")).toContain("source this annotation points into");
  });

  it("should fill the placeholders a message declares", () => {
    expect(messageFor("peek.target.missing", { kind: "board" })).toBe(
      "That board is no longer in this workspace.",
    );
    expect(messageFor("blueprint.install.unsupported", { kind: "richDate" })).toContain(
      "the kind richDate",
    );
  });

  it("should leave a placeholder with no value as written", () => {
    expect(messageFor("peek.target.missing")).toContain("{kind}");
  });

  it("should return an unknown code unchanged so a report can still grep it", () => {
    expect(messageFor("canvas.unknown.code")).toBe("canvas.unknown.code");
  });

  it("should serve the only locale this build ships", () => {
    expect(locales).toEqual(["en"]);
  });
});

describe("formatMessage", () => {
  it("should fill every occurrence of a placeholder", () => {
    expect(formatMessage("{card} and {card}", { card: "Alpha" })).toBe("Alpha and Alpha");
  });

  it("should stringify numeric params without locale formatting", () => {
    expect(formatMessage("{count} cards", { count: 1200 })).toBe("1200 cards");
  });

  it("should leave text with no placeholders alone", () => {
    const template = "Nothing {here} is a placeholder without a token" as string;
    expect(formatMessage("plain sentence")).toBe("plain sentence");
    expect(formatMessage(template, { here: "x" })).toBe(
      "Nothing x is a placeholder without a token",
    );
  });

  it("should not treat a brace that is not a placeholder as one", () => {
    expect(formatMessage("{ not a token }")).toBe("{ not a token }");
  });

  it("should type the code set as a closed union", () => {
    const code: ErrorCode = "annotation.range.unanchored";
    expect(errorCodes).toContain(code);
  });
});
