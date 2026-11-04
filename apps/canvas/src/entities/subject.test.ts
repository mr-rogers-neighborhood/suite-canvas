import { describe, expect, it } from "vitest";
import {
  primaryNodeIdFor,
  selectionSubject,
  styleTargetsFor,
  subjectKindsForTables,
} from "./subject";

const NONE = { nodeIds: [], sectionIds: [], edgeIds: [], portalIds: new Set<string>() };

describe("what a surface is looking at", () => {
  it("is empty for an empty selection", () => {
    const subject = selectionSubject(NONE);
    expect(subject.isEmpty).toBe(true);
    expect(subject.primary).toBeNull();
    // With nothing selected, the capability tables answer for the canvas.
    expect(subjectKindsForTables(subject)).toEqual(["canvas"]);
  });

  it("reads a portal as its own kind and counts it apart from cards", () => {
    const subject = selectionSubject({
      ...NONE,
      nodeIds: ["a", "door"],
      portalIds: new Set(["door"]),
    });
    expect(subject.kinds).toEqual(["portal", "card"]);
    expect(subject.counts).toEqual({ cards: 1, sections: 0, links: 0 });
  });

  /** Most specific first, so a single-thing surface describes the link rather than its ends. */
  it("orders the kinds by specificity", () => {
    const subject = selectionSubject({
      ...NONE,
      nodeIds: ["a"],
      sectionIds: ["s"],
      edgeIds: ["e"],
    });
    expect(subject.kinds).toEqual(["card", "edge", "section"]);
    expect(subject.primary).toBe("card");
  });

  it("keeps two frames as two sections, which is what multi-select is for", () => {
    const subject = selectionSubject({ ...NONE, sectionIds: ["outer", "inner", "outer"] });
    expect(subject.sectionIds).toEqual(["outer", "inner"]);
    expect(subject.counts.sections).toBe(2);
    expect(subject.primary).toBe("section");
    expect(subjectKindsForTables(subject)).toEqual(["section"]);
  });
});

describe("styleTargetsFor", () => {
  it("hands the style editor every kind of the selection", () => {
    const subject = selectionSubject({
      nodeIds: ["card-1", "card-2"],
      sectionIds: ["frame-1"],
      edgeIds: ["link-1"],
      portalIds: new Set<string>(),
    });

    expect(styleTargetsFor(subject)).toEqual([
      { kind: "card", id: "card-1" },
      { kind: "card", id: "card-2" },
      { kind: "edge", id: "link-1" },
      { kind: "section", id: "frame-1" },
    ]);
  });

  it("is empty for an empty selection", () => {
    expect(styleTargetsFor(selectionSubject(NONE))).toEqual([]);
  });
});

describe("primaryNodeIdFor", () => {
  it("keeps the card the reader pressed", () => {
    expect(primaryNodeIdFor("pressed", ["a", "b"])).toBe("pressed");
  });

  it("opens on the last of a marquee", () => {
    expect(primaryNodeIdFor(null, ["a", "b", "c"])).toBe("c");
  });

  it("is nothing when there is no press and nothing selected", () => {
    expect(primaryNodeIdFor(null, [])).toBeNull();
  });
});
