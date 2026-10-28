import type { Connector } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { attachDots, connectorToward, dotPoint, type FacingBox } from "./attachDots";

const box = (x: number, y: number): FacingBox => ({ x, y, width: 288, height: 240 });
const dots = (labels: readonly string[]): Connector[] =>
  labels.map((label, index) => {
    const sides: Record<string, { x: number; y: number }> = {
      top: { x: 0.5, y: 0 },
      right: { x: 1, y: 0.5 },
      bottom: { x: 0.5, y: 1 },
      left: { x: 0, y: 0.5 },
    };
    return { id: label, ...(sides[label] ?? { x: 0.5, y: 0.5 }), index } as Connector;
  });

describe("attach dots", () => {
  it("puts a dot's point on the perimeter it sits at", () => {
    const [right] = dots(["right"]);
    if (!right) throw new Error("expected a dot");
    expect(dotPoint(box(100, 100), right)).toEqual({ x: 388, y: 220 });
  });

  it("picks the dot facing the target", () => {
    const left = box(0, 0);
    const cards = dots(["top", "right", "bottom", "left"]);
    // Something to the right of the card: the right dot is the near one.
    expect(connectorToward(cards, left, { x: 900, y: 120 })?.id).toBe("right");
    expect(connectorToward(cards, left, { x: 144, y: -400 })?.id).toBe("top");
  });

  it("leaves the side facing the new card and arrives on the side facing that dot", () => {
    const anchor = box(0, 0);
    const card = box(700, 0);
    const { source, target } = attachDots({
      anchorDots: dots(["top", "right", "bottom", "left"]),
      anchorBox: anchor,
      cardDots: dots(["top", "right", "bottom", "left"]),
      cardBox: card,
    });
    expect(source?.id).toBe("right");
    expect(target?.id).toBe("left");
  });

  it("turns the arrival to face a fan's spoke rather than the hub's centre", () => {
    const anchor = box(0, 0);
    // Straight above: the anchor's top dot is nearest, and the spoke lands on the card's
    // bottom one, which is what makes a starburst read as spokes rather than as a web.
    const card = box(0, -420);
    const { source, target } = attachDots({
      anchorDots: dots(["top", "right", "bottom", "left"]),
      anchorBox: anchor,
      cardDots: dots(["top", "right", "bottom", "left"]),
      cardBox: card,
    });
    expect(source?.id).toBe("top");
    expect(target?.id).toBe("bottom");
  });

  it("says nothing when a card has no dots", () => {
    const { source, target } = attachDots({
      anchorDots: [],
      anchorBox: box(0, 0),
      cardDots: dots(["left"]),
      cardBox: box(600, 0),
    });
    expect(source).toBeNull();
    expect(target?.id).toBe("left");
  });
});
