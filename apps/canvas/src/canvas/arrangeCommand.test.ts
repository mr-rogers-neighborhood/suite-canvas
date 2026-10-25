import type { Placement, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { type ArrangeTarget, growSectionsToFit, planAlign, planDistribute } from "./arrangeCommand";

const BOARD = "b1";

function placement(
  cardId: string,
  x: number,
  y: number,
  extra: Partial<Placement> = {},
): Placement {
  return { boardId: BOARD, cardId, x, y, z: 0, createdAt: 0, ...extra };
}

function target(
  placements: Placement[],
  selectedCardIds: string[],
  sections: Section[] = [],
): ArrangeTarget {
  return { boardId: BOARD, placements, sections, selectedCardIds };
}

describe("planAlign", () => {
  it("aligns the selection's left edges to the leftmost card", () => {
    const plan = planAlign(
      target([placement("a", 0, 0), placement("b", 400, 100)], ["a", "b"]),
      "left",
    );
    // Only the moved card is written; the anchor is left alone.
    expect(plan?.placements.map((entry) => [entry.cardId, entry.x, entry.y])).toEqual([
      ["b", 0, 100],
    ]);
  });

  it("aligns bottoms to the lowest edge", () => {
    const plan = planAlign(
      target([placement("a", 0, 0), placement("b", 400, 100)], ["a", "b"]),
      "bottom",
    );
    // Both cards are the same height, so the higher one moves down to match.
    expect(plan?.placements.map((entry) => [entry.cardId, entry.y])).toEqual([["a", 100]]);
  });

  it("does nothing with fewer than two cards selected", () => {
    expect(
      planAlign(target([placement("a", 0, 0), placement("b", 400, 0)], ["a"]), "left"),
    ).toBeNull();
  });

  it("returns null when everything is already aligned", () => {
    expect(
      planAlign(target([placement("a", 0, 0), placement("b", 0, 200)], ["a", "b"]), "left"),
    ).toBeNull();
  });

  it("ignores cards on another board and cards not selected", () => {
    const plan = planAlign(
      target(
        [
          placement("a", 0, 0),
          placement("b", 400, 55),
          placement("other", 900, 90, { boardId: "b2" }),
          placement("idle", 10, 500),
        ],
        ["a", "b"],
      ),
      "top",
    );
    // Only the selected card on this board moves; the other board's card and the
    // unselected one are not touched, and they do not stretch the bounding box.
    expect(plan?.placements.map((entry) => [entry.cardId, entry.y])).toEqual([["b", 0]]);
  });
});

describe("planDistribute", () => {
  it("equalises the gaps between three cards and keeps the extremes put", () => {
    const plan = planDistribute(
      target(
        [placement("a", 0, 0), placement("b", 100, 40), placement("c", 900, 80)],
        ["a", "b", "c"],
      ),
      "horizontal",
    );
    // a stays at 0, c stays at 900; b moves to the middle of the remaining span.
    expect(plan?.placements).toHaveLength(1);
    expect(plan?.placements[0]?.cardId).toBe("b");
    expect(plan?.placements[0]?.x).toBe(450);
    expect(plan?.placements[0]?.y).toBe(40);
  });

  it("needs three cards, because two have no gap to equalise", () => {
    expect(
      planDistribute(
        target([placement("a", 0, 0), placement("b", 900, 0)], ["a", "b"]),
        "horizontal",
      ),
    ).toBeNull();
  });

  it("distributes vertically in visual order, not selection order", () => {
    const plan = planDistribute(
      target(
        [placement("c", 0, 900), placement("a", 0, 0), placement("b", 0, 100)],
        ["c", "a", "b"],
      ),
      "vertical",
    );
    expect(plan?.placements[0]?.cardId).toBe("b");
  });
});

describe("growSectionsToFit", () => {
  const section: Section = {
    id: "s1",
    boardId: BOARD,
    title: "",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  it("grows a section that a moved card now overhangs", () => {
    const [grown] = growSectionsToFit([section], [{ x: 100, y: 100, width: 400, height: 240 }]);
    expect(grown).toMatchObject({ width: 500, height: 340 });
  });

  it("never shrinks a section someone sized by hand", () => {
    expect(growSectionsToFit([section], [{ x: 10, y: 10, width: 20, height: 20 }])).toEqual([]);
  });

  it("leaves a section alone when no card is inside it", () => {
    expect(growSectionsToFit([section], [{ x: 900, y: 900, width: 10, height: 10 }])).toEqual([]);
  });
});
