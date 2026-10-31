import { describe, expect, it } from "vitest";
import { embedStubLabel, resolveEmbed } from "./embedPlan.js";

const exists = (ids: string[]) => (cardId: string) => ids.includes(cardId);
const lookup = { cardExists: exists(["a", "b"]) };

describe("resolveEmbed", () => {
  it("should resolve a card this reader can see", () => {
    expect(resolveEmbed("a", { depth: 1, ancestors: [] }, lookup)).toEqual({
      kind: "card",
      cardId: "a",
      depth: 1,
      // A lookup with no type information still answers with a figure: the face.
      figure: "face",
      boardId: null,
    });
  });

  it("should ask for a card when none was chosen", () => {
    expect(resolveEmbed(null, { depth: 1, ancestors: [] }, lookup)).toMatchObject({
      kind: "stub",
      reason: "unset",
    });
  });

  it("should say a card is gone rather than draw an empty frame", () => {
    expect(resolveEmbed("gone", { depth: 1, ancestors: [] }, lookup)).toMatchObject({
      kind: "stub",
      reason: "missing",
    });
  });

  it("should stop a loop, naming the card it would have shown", () => {
    expect(resolveEmbed("a", { depth: 1, ancestors: ["b", "a"] }, lookup)).toEqual({
      kind: "stub",
      reason: "cycle",
      cardId: "a",
    });
  });

  it("should render one level and stub the next", () => {
    expect(resolveEmbed("a", { depth: 1, ancestors: [] }, lookup).kind).toBe("card");
    expect(resolveEmbed("a", { depth: 2, ancestors: [] }, lookup).kind).toBe("stub");
  });

  it("should prefer 'not shared' over a cycle, because it is the useful answer", () => {
    expect(
      resolveEmbed("a", { depth: 1, ancestors: ["a"] }, { ...lookup, visible: () => false }),
    ).toMatchObject({ reason: "not-shared" });
  });

  it("should have words for every reason", () => {
    for (const reason of ["unset", "missing", "not-shared", "cycle"] as const) {
      expect(embedStubLabel(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("embed figures", () => {
  const types: Record<string, string> = { sketchy: "whiteboard", door: "portal", note: "note" };
  const portraits: Record<string, string> = { door: "board-1" };
  const withTypes = {
    ...lookup,
    cardExists: exists(["sketchy", "door", "note", "orphan-portal"]),
    cardTypeOf: (id: string) => types[id],
    portalBoardOf: (id: string) => portraits[id],
  };

  it("should draw a sketch as its drawing, not as a title over nothing", () => {
    expect(resolveEmbed("sketchy", { depth: 1, ancestors: [] }, withTypes)).toMatchObject({
      kind: "card",
      figure: "sketch",
      boardId: null,
    });
  });

  it("should draw a portal as the board it opens", () => {
    expect(resolveEmbed("door", { depth: 1, ancestors: [] }, withTypes)).toMatchObject({
      kind: "card",
      figure: "board",
      boardId: "board-1",
    });
  });

  it("should fall back to the face when a portal has no board to open", () => {
    // The card exists and has text, so an empty frame would be a lie about it.
    expect(resolveEmbed("orphan-portal", { depth: 1, ancestors: [] }, withTypes)).toMatchObject({
      kind: "card",
      figure: "face",
      boardId: null,
    });
  });

  it("should draw any other card as its face", () => {
    expect(resolveEmbed("note", { depth: 1, ancestors: [] }, withTypes)).toMatchObject({
      figure: "face",
    });
  });
});
