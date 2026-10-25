import { describe, expect, it } from "vitest";
import { isArmed, isChaining, sameConnector, stepThread } from "./linkThread";

const a = { kind: "card" as const, id: "card-a", connectorId: "a-right" };
const b = { kind: "card" as const, id: "card-b", connectorId: "b-left" };
const c = { kind: "section" as const, id: "section-c", connectorId: "c-top" };

describe("isChaining", () => {
  it("chains when shift is held, in either mode", () => {
    expect(isChaining({ shiftKey: true, linkMode: "connect" })).toBe(true);
    expect(isChaining({ shiftKey: true, linkMode: "thread" })).toBe(true);
  });

  it("chains on a plain click in thread mode", () => {
    expect(isChaining({ shiftKey: false, linkMode: "thread" })).toBe(true);
  });

  it("does not chain on a plain click in connect mode", () => {
    expect(isChaining({ linkMode: "connect" })).toBe(false);
  });
});

describe("stepThread", () => {
  it("arms the first connector without drawing a link", () => {
    expect(stepThread(null, a)).toEqual({ armed: a, link: null });
  });

  it("links from the armed connector and arms the one just clicked", () => {
    expect(stepThread(a, b)).toEqual({ armed: b, link: { from: a, to: b } });
  });

  it("keeps growing from its own tail", () => {
    const second = stepThread(stepThread(a, b).armed, c);
    expect(second.link).toEqual({ from: b, to: c });
    expect(second.armed).toEqual(c);
  });

  it("disarms when the armed connector is clicked again", () => {
    expect(stepThread(a, a)).toEqual({ armed: null, link: null });
  });

  it("links across kinds, so a thread can leave a card for a section", () => {
    expect(stepThread(a, c).link).toEqual({ from: a, to: c });
  });
});

describe("sameConnector", () => {
  it("compares kind, id and connector", () => {
    expect(sameConnector(a, { ...a })).toBe(true);
    expect(sameConnector(a, { ...a, connectorId: "other" })).toBe(false);
    expect(sameConnector(a, { ...a, kind: "section" })).toBe(false);
  });

  it("leaves an unrelated connector unarmed", () => {
    expect(isArmed(a, b)).toBe(false);
    expect(isArmed(a, a)).toBe(true);
    expect(isArmed(null, a)).toBe(false);
  });
});
