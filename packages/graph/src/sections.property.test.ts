import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Placement, Section } from "./schema.js";
import { cardAnchor, rectContainsPoint, sectionMembership } from "./sections.js";

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const geometryArb: fc.Arbitrary<Geometry> = fc.record({
  x: fc.integer({ min: -40, max: 40 }),
  y: fc.integer({ min: -40, max: 40 }),
  width: fc.integer({ min: 20, max: 200 }),
  height: fc.integer({ min: 20, max: 200 }),
});

const insetArb = fc.record({
  left: fc.integer({ min: 0, max: 60 }),
  top: fc.integer({ min: 0, max: 60 }),
  right: fc.integer({ min: 0, max: 60 }),
  bottom: fc.integer({ min: 0, max: 60 }),
  z: fc.integer({ min: -3, max: 3 }),
});

/**
 * One outer rectangle plus up to three genuinely nested insets, so the
 * "smallest containing section" branch is exercised instead of only the
 * "no section contains this card" branch random rectangles would mostly hit.
 */
const sectionsArb: fc.Arbitrary<Section[]> = fc
  .record({
    outer: geometryArb,
    insets: fc.array(insetArb, { minLength: 0, maxLength: 3 }),
  })
  .map(({ outer, insets }) => {
    const sections: Section[] = [
      {
        id: "s0",
        boardId: "board-1",
        title: "Outer",
        x: outer.x,
        y: outer.y,
        width: outer.width,
        height: outer.height,
        z: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    for (const [index, inset] of insets.entries()) {
      const left = Math.min(inset.left, outer.width - 2);
      const top = Math.min(inset.top, outer.height - 2);
      const width = Math.max(1, outer.width - left - Math.min(inset.right, outer.width - left - 1));
      const height = Math.max(
        1,
        outer.height - top - Math.min(inset.bottom, outer.height - top - 1),
      );
      sections.push({
        id: `s${index + 1}`,
        boardId: "board-1",
        title: `Inner ${index + 1}`,
        x: outer.x + left,
        y: outer.y + top,
        width,
        height,
        z: inset.z,
        createdAt: index + 1,
        updatedAt: index + 1,
      });
    }
    return sections;
  });

const pointsArb = fc.array(
  fc.record({
    x: fc.integer({ min: -60, max: 260 }),
    y: fc.integer({ min: -60, max: 260 }),
  }),
  { minLength: 1, maxLength: 5 },
);

function placement(
  cardId: string,
  point: { x: number; y: number },
  extras: { z: number; boardId: string; createdAt: number },
): Placement {
  return {
    boardId: extras.boardId,
    cardId,
    x: point.x,
    y: point.y,
    z: extras.z,
    createdAt: extras.createdAt,
  };
}

function area(section: Section): number {
  return section.width * section.height;
}

describe("sectionMembership properties", () => {
  it("depends only on placement coordinates, never on z, board or section order", () => {
    fc.assert(
      fc.property(sectionsArb, pointsArb, (sections, points) => {
        const first = points.map((point, index) =>
          placement(`c${index}`, point, { z: index, boardId: "board-1", createdAt: index }),
        );
        const second = points.map((point, index) =>
          placement(`c${index}`, point, {
            z: -index,
            boardId: `board-${index + 2}`,
            createdAt: 1000 - index,
          }),
        );

        const baseline = [...sectionMembership(first, sections)];
        const reordered = [...sectionMembership(second, [...sections].reverse())];

        expect(reordered).toEqual(baseline);
      }),
      { numRuns: 60, verbose: true },
    );
  });

  it("assigns exactly the smallest containing section, and only when one contains the anchor", () => {
    fc.assert(
      fc.property(sectionsArb, pointsArb, (sections, points) => {
        const placements = points.map((point, index) =>
          placement(`c${index}`, point, { z: index, boardId: "board-1", createdAt: index }),
        );
        const membership = sectionMembership(placements, sections);

        for (const card of placements) {
          const anchor = cardAnchor(card);
          const containing = sections.filter((section) => rectContainsPoint(section, anchor));
          const ownerId = membership.get(card.cardId);

          expect(
            ownerId !== undefined,
            `anchor ${JSON.stringify(anchor)} in ${JSON.stringify(sections)}`,
          ).toBe(containing.length > 0);
          if (ownerId === undefined) continue;

          const owner = sections.find((section) => section.id === ownerId);
          expect(owner).toBeDefined();
          if (!owner) continue;

          expect(rectContainsPoint(owner, anchor)).toBe(true);
          // No section with a strictly smaller area may contain the same anchor.
          for (const candidate of containing) {
            expect(
              area(candidate),
              `${candidate.id} (${area(candidate)}) is smaller than the owner ${owner.id} (${area(owner)})`,
            ).toBeGreaterThanOrEqual(area(owner));
          }
        }
      }),
      { numRuns: 60, verbose: true },
    );
  });
});
