import { describe, expect, it } from "vitest";
import {
  gestureMode,
  isArmed,
  isChaining,
  sameConnector,
  stepFan,
  stepLink,
  stepThread,
} from "./linkThread";

const a = { kind: "card" as const, id: "card-a", connectorId: "a-right" };
const b = { kind: "card" as const, id: "card-b", connectorId: "b-left" };
const c = { kind: "section" as const, id: "section-c", connectorId: "c-top" };

describe("isChaining", () => {
  it("chains when shift is held, in either mode", () => {
    expect(isChaining({ shiftKey: true, mode: "place" })).toBe(true);
    expect(isChaining({ shiftKey: true, mode: "thread" })).toBe(true);
  });

  it("chains on a plain click in thread mode", () => {
    expect(isChaining({ shiftKey: false, mode: "thread" })).toBe(true);
  });

  it("does not chain on a plain click in connect mode", () => {
    expect(isChaining({ mode: "place" })).toBe(false);
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

describe("fan mode", () => {
  const origin = { kind: "card" as const, id: "a", connectorId: "a1" };
  const spokeB = { kind: "card" as const, id: "b", connectorId: "b1" };
  const spokeC = { kind: "card" as const, id: "c", connectorId: "c1" };

  it("arms the first click and links every later click from that origin", () => {
    const first = stepFan(null, origin);
    expect(first).toEqual({ armed: origin, link: null });

    const second = stepFan(first.armed, spokeB);
    expect(second.link).toEqual({ from: origin, to: spokeB });
    // The origin stays armed: this is the whole difference from a thread, which
    // would have moved it to B and recorded B→C next.
    expect(second.armed).toEqual(origin);

    const third = stepFan(second.armed, spokeC);
    expect(third.link).toEqual({ from: origin, to: spokeC });
    expect(third.armed).toEqual(origin);
  });

  it("disarms when the origin itself is clicked again", () => {
    expect(stepFan(origin, origin)).toEqual({ armed: null, link: null });
  });

  it("a thread and a fan draw different graphs from the same three clicks", () => {
    const threaded = stepThread(stepThread(null, origin).armed, spokeB);
    const fan = stepFan(stepFan(null, origin).armed, spokeB);
    expect(threaded.link).toEqual({ from: origin, to: spokeB });
    expect(fan.link).toEqual({ from: origin, to: spokeB });

    // The second click is where they diverge: A→C in a fan, B→C in a thread.
    expect(stepFan(fan.armed, spokeC).link).toEqual({ from: origin, to: spokeC });
    expect(stepThread(threaded.armed, spokeC).link).toEqual({ from: spokeB, to: spokeC });
  });

  it("stepLink follows the mode it is given", () => {
    expect(stepLink("fan", origin, spokeB).armed).toEqual(origin);
    expect(stepLink("thread", origin, spokeB).armed).toEqual(spokeB);
    expect(stepLink("place", origin, spokeB).armed).toEqual(spokeB);
  });

  it("reads a held key as the mode it implies", () => {
    expect(gestureMode({ ctrlKey: true, mode: "place" })).toBe("fan");
    expect(gestureMode({ shiftKey: true, mode: "place" })).toBe("thread");
    // Control is the more specific gesture when both are down.
    expect(gestureMode({ shiftKey: true, ctrlKey: true, mode: "thread" })).toBe("fan");
    expect(gestureMode({ mode: "fan" })).toBe("fan");
    expect(gestureMode({ mode: "place" })).toBe("place");
  });

  it("chains without a modifier when the mode is fan", () => {
    expect(isChaining({ mode: "fan" })).toBe(true);
    expect(isChaining({ mode: "thread" })).toBe(true);
    expect(isChaining({ mode: "place" })).toBe(false);
    expect(isChaining({ mode: "place", ctrlKey: true })).toBe(true);
  });
});
