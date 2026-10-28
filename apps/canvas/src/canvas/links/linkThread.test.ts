import { beforeEach, describe, expect, it } from "vitest";
import {
  isArmed,
  isChaining,
  modifierMode,
  sameConnector,
  stepFan,
  stepLink,
  stepShape,
  stepThread,
  useLinkThreadStore,
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
    expect(stepThread(null, a)).toEqual({ armed: a, link: null, handoff: false });
  });

  it("links from the armed connector and arms the one just clicked", () => {
    expect(stepThread(a, b)).toEqual({ armed: b, link: { from: a, to: b }, handoff: false });
  });

  it("keeps growing from its own tail", () => {
    const second = stepThread(stepThread(a, b).armed, c);
    expect(second.link).toEqual({ from: b, to: c });
    expect(second.armed).toEqual(c);
  });

  it("disarms when the armed connector is clicked again", () => {
    expect(stepThread(a, a)).toEqual({ armed: null, link: null, handoff: false });
  });

  it("hands the thread off to another port of the same card", () => {
    // A thread is a route through a card and a route has ports, so top -> bottom on
    // one card is one step, not a cancel — but it is a *handoff*: the thread leaves
    // from the port it just picked. Drawing A.top -> A.bottom instead would say the
    // card points at itself, which is the opposite of passing through it.
    const top = { kind: "card" as const, id: "a", connectorId: "a-top" };
    const bottom = { kind: "card" as const, id: "a", connectorId: "a-bottom" };

    const step = stepThread(top, bottom);

    expect(step.handoff).toBe(true);
    expect(step.link).toBeNull();
    // The port moved, so the next click leaves the card by the bottom.
    expect(step.armed).toEqual(bottom);
  });

  it("hands off without depending on where the cards are", () => {
    // The reader chose both ports: no bounding box decides which one is the way in.
    const top = { kind: "card" as const, id: "a", connectorId: "a-top" };
    const bottom = { kind: "card" as const, id: "a", connectorId: "a-bottom" };

    expect(stepThread(bottom, top).armed).toEqual(top);
    expect(stepThread(bottom, top).handoff).toBe(true);
  });

  it("leaves the through-line to the next click, which links from the new port", () => {
    const top = { kind: "card" as const, id: "a", connectorId: "a-top" };
    const bottom = { kind: "card" as const, id: "a", connectorId: "a-bottom" };
    const other = { kind: "card" as const, id: "b", connectorId: "b-left" };

    const handoff = stepThread(top, bottom);
    const leave = stepThread(handoff.armed, other);

    // One edge, and it starts at the port the handoff chose — nothing points at A.
    expect(leave.link).toEqual({ from: bottom, to: other });
    expect(leave.handoff).toBe(false);
  });

  it("hands off between sections too", () => {
    const north = { kind: "section" as const, id: "s1", connectorId: "s1-top" };
    const south = { kind: "section" as const, id: "s1", connectorId: "s1-bottom" };

    expect(stepThread(north, south)).toEqual({ armed: south, link: null, handoff: true });
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
    expect(first).toEqual({ armed: origin, link: null, handoff: false });

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
    expect(stepFan(origin, origin)).toEqual({ armed: null, link: null, handoff: false });
  });

  it("keeps the self-loop, because every spoke leaves the same port", () => {
    // A fan has no route to hand off: the origin is an anchor, not a way through,
    // so a spoke to another port of it is the loop it always was (ADR-0061 §7).
    const other = { kind: "card" as const, id: "a", connectorId: "a2" };

    const step = stepFan(origin, other);

    expect(step.link).toEqual({ from: origin, to: other });
    expect(step.handoff).toBe(false);
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
    expect(modifierMode({ ctrlKey: true })).toBe("fan");
    expect(modifierMode({ shiftKey: true })).toBe("thread");
    // Control is the more specific gesture when both are down.
    expect(modifierMode({ shiftKey: true, ctrlKey: true })).toBe("fan");
    expect(modifierMode({})).toBe(null);
  });

  /**
   * The bug this covers: a fan started by *holding* Control became a thread on the
   * next click, because the shape was read from the stored mode again once the key
   * came up. The spokes then left from the card clicked second, so the graph was a
   * chain nobody asked for instead of a hub.
   */
  it("keeps a fan a fan after the key that started it is released", () => {
    const armedShape = stepShape({ ctrlKey: true, mode: "place", armedShape: null });
    expect(armedShape).toBe("fan");

    // Key up, no modifier, nothing chosen in the control: the arm still decides.
    const afterRelease = stepShape({ mode: "place", armedShape });
    expect(afterRelease).toBe("fan");
    expect(stepLink(afterRelease, origin, spokeB)).toEqual({
      armed: origin,
      link: { from: origin, to: spokeB },
      handoff: false,
    });
    expect(stepLink(afterRelease, origin, spokeC).link).toEqual({ from: origin, to: spokeC });
  });

  it("still lets a held key say what it means over a stale arm", () => {
    expect(stepShape({ shiftKey: true, mode: "place", armedShape: "fan" })).toBe("thread");
    expect(stepShape({ ctrlKey: true, mode: "place", armedShape: "thread" })).toBe("fan");
  });

  it("falls back to the stored mode when nothing is armed", () => {
    expect(stepShape({ mode: "thread", armedShape: null })).toBe("thread");
    expect(stepShape({ mode: "place", armedShape: null })).toBe("place");
  });

  it("chains without a modifier when the mode is fan", () => {
    expect(isChaining({ mode: "fan" })).toBe(true);
    expect(isChaining({ mode: "thread" })).toBe(true);
    expect(isChaining({ mode: "place" })).toBe(false);
    expect(isChaining({ mode: "place", ctrlKey: true })).toBe(true);
  });
});

describe("the armed origin", () => {
  const origin = { kind: "card" as const, id: "a", connectorId: "a1" };

  // One store for the module, so each test starts from an unarmed canvas.
  beforeEach(() => useLinkThreadStore.getState().clear());

  it("records the shape it draws, and forgets it when the arm ends", () => {
    const store = useLinkThreadStore.getState();
    store.arm(origin, "gesture", "fan");
    expect(useLinkThreadStore.getState().armedShape).toBe("fan");

    store.clear();
    expect(useLinkThreadStore.getState().armedShape).toBe(null);
    expect(useLinkThreadStore.getState().armed).toBe(null);
  });

  it("drops the hovered target whenever the arm changes", () => {
    const store = useLinkThreadStore.getState();
    store.arm(origin, "mode", "fan");
    store.setTarget({ kind: "card", id: "b", connectorId: "b1" });
    expect(useLinkThreadStore.getState().target?.id).toBe("b");

    // A new arm asks a new question; the dot hovered before it means nothing now.
    store.arm(origin, "mode", "fan");
    expect(useLinkThreadStore.getState().target).toBe(null);
  });

  it("ignores a target while nothing is armed", () => {
    const store = useLinkThreadStore.getState();
    store.setTarget({ kind: "card", id: "b", connectorId: "b1" });
    expect(useLinkThreadStore.getState().target).toBe(null);
  });
});
