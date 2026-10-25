import type { Card, GraphEdge, Placement, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  boardBounds,
  boardMiniature,
  MINIATURE_CARD_SIZE,
  miniatureDots,
  miniatureSectionColor,
} from "./portalMiniature";

function placement(
  cardId: string,
  x: number,
  y: number,
  extra: Partial<Placement> = {},
): Placement {
  return { boardId: "b1", cardId, x, y, z: 0, createdAt: 0, ...extra };
}

function section(id: string, x: number, y: number, width: number, height: number): Section {
  return {
    id,
    boardId: "b1",
    title: "",
    x,
    y,
    width,
    height,
    z: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("boardBounds", () => {
  it("should return null for a board with nothing on it", () => {
    expect(boardBounds([], [])).toBeNull();
  });

  it("should use the natural card size when a placement has no geometry", () => {
    const bounds = boardBounds([], [placement("c1", 0, 0)]);
    expect(bounds).not.toBeNull();
    // Padded by 36 on each side and widened to the minimum board box.
    expect(bounds?.width).toBe(360 + 72);
    expect(bounds?.height).toBe(240 + 72);
    // The lone card is centred rather than pinned to the corner.
    expect(bounds?.x).toBe(-104);
    expect(bounds?.y).toBe(-76);
    expect(MINIATURE_CARD_SIZE).toEqual({ width: 224, height: 160 });
  });

  it("should cover sections as well as cards", () => {
    const bounds = boardBounds([section("s1", -200, -100, 900, 500)], [placement("c1", 0, 0)]);
    expect(bounds?.x).toBeLessThanOrEqual(-200);
    expect(bounds?.y).toBeLessThanOrEqual(-100);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeGreaterThanOrEqual(700);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeGreaterThanOrEqual(400);
  });
});

describe("boardMiniature", () => {
  it("should report an empty board without drawing anything", () => {
    const model = boardMiniature([], []);
    expect(model.empty).toBe(true);
    expect(model.cards).toEqual([]);
    expect(model.sections).toEqual([]);
    expect(model.cardCount).toBe(0);
    expect(model.viewBox.width).toBe(100);
  });

  it("should normalise the longest side to 100 units and keep the aspect", () => {
    const bounds = boardBounds([], [placement("c1", 0, 0), placement("c2", 600, 0)]);
    const model = boardMiniature([], [placement("c1", 0, 0), placement("c2", 600, 0)]);

    expect(model.viewBox.width).toBe(100);
    expect(model.viewBox.height).toBeCloseTo(
      (100 * (bounds?.height ?? 0)) / (bounds?.width ?? 1),
      1,
    );
    expect(model.cardCount).toBe(2);
    expect(model.empty).toBe(false);
  });

  it("should keep every rect inside the view box", () => {
    const model = boardMiniature(
      [section("s1", -50, -50, 800, 400), section("s2", 200, 100, 300, 200)],
      [
        placement("c1", 0, 0, { width: 240, height: 120 }),
        placement("c2", 500, 250, { width: 180, height: 220 }),
      ],
    );

    for (const rect of [...model.sections, ...model.cards]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(model.viewBox.width + 0.01);
      expect(rect.y + rect.height).toBeLessThanOrEqual(model.viewBox.height + 0.01);
    }
  });

  it("should preserve relative spacing between cards", () => {
    const model = boardMiniature([], [placement("c1", 0, 0), placement("c2", 448, 0)]);
    const [first, second] = model.cards;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Two default cards side by side plus a card gap: the second starts about
    // one card-width after the first, scaled with the rest of the board.
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBeCloseTo(
      ((first?.width ?? 0) / MINIATURE_CARD_SIZE.width) * 448,
      0,
    );
  });

  it("should paint sections in z order and cards in placement order", () => {
    const model = boardMiniature(
      [section("s2", 0, 0, 100, 100), { ...section("s1", 0, 0, 100, 100), z: -1 }],
      [placement("c2", 0, 0, { z: 2 }), placement("c1", 0, 0, { z: 1 })],
    );
    expect(model.sections.map((entry) => entry.sectionId)).toEqual(["s1", "s2"]);
    expect(model.cards.map((card) => card.cardId)).toEqual(["c1", "c2"]);
  });

  it("should keep the section colour for the band's token", () => {
    const model = boardMiniature([section("s1", 0, 0, 100, 100)], []);
    expect(model.sections[0]?.color).toBeUndefined();
    expect(miniatureSectionColor(undefined)).toBe(
      "color-mix(in srgb, var(--section-slate) 18%, transparent)",
    );
    expect(miniatureSectionColor("violet")).toBe(
      "color-mix(in srgb, var(--section-violet) 18%, transparent)",
    );
  });
});

describe("miniatureDots", () => {
  const model = boardMiniature([], [placement("c1", 0, 0), placement("c2", 600, 0)]);

  it("should place a dot at the centre of the card a peer is reading", () => {
    const dots = miniatureDots(model, [
      { focus: { nodeId: "c1" }, user: { color: "#f00", name: "Ada" } },
    ]);
    const card = model.cards.find((entry) => entry.cardId === "c1");
    expect(dots).toEqual([
      {
        x: (card?.x ?? 0) + (card?.width ?? 0) / 2,
        y: (card?.y ?? 0) + (card?.height ?? 0) / 2,
        color: "#f00",
        label: "Ada",
      },
    ]);
  });

  it("should ignore peers with no focused card, or a card on another board", () => {
    const dots = miniatureDots(model, [
      { focus: null, user: { color: "#0f0", name: "Bob" } },
      { focus: { nodeId: "elsewhere" }, user: { color: "#00f", name: "Cy" } },
    ]);
    expect(dots).toEqual([]);
  });
});

describe("miniature links", () => {
  const cards = [
    { id: "c1", connectors: [{ id: "c1-right", x: 1, y: 0.5 }], properties: {}, deletedAt: null },
    { id: "c2", connectors: [{ id: "c2-left", x: 0, y: 0.5 }], properties: {}, deletedAt: null },
  ] as unknown as Card[];

  it("draws a link whose both ends are on the board, from dot to dot", () => {
    const model = boardMiniature([], [placement("c1", 0, 0), placement("c2", 600, 0)], {
      cards,
      edges: [
        {
          id: "e1",
          boardId: "b1",
          source: "c1",
          sourceKind: "card",
          target: "c2",
          targetKind: "card",
          sourceConnector: "c1-right",
          targetConnector: "c2-left",
        } as unknown as GraphEdge,
      ],
    });

    expect(model.links).toHaveLength(1);
    // The right dot of the left card, the left dot of the right card: the
    // miniature uses the same anchors, so x1 < x2 and both sit on the mid line.
    const [link] = model.links;
    expect(link?.x1).toBeLessThan(link?.x2 ?? 0);
    expect(link?.y1).toBe(link?.y2);
    expect(link?.edgeId).toBe("e1");
  });

  it("leaves out a link with an end that is not here", () => {
    const model = boardMiniature([], [placement("c1", 0, 0)], {
      cards,
      edges: [
        {
          id: "e2",
          boardId: "b1",
          source: "c1",
          target: "elsewhere",
          targetKind: "card",
        } as unknown as GraphEdge,
      ],
    });
    expect(model.links).toHaveLength(0);
  });
});
