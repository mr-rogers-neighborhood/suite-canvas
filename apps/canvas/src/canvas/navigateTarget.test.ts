import { describe, expect, it } from "vitest";
import type { NavigationScene } from "./navigateTarget";
import { planNavigation, targetOfFocus } from "./navigateTarget";

function scene(overrides: Partial<NavigationScene> = {}): NavigationScene {
  return {
    activeBoardId: "b1",
    openBoardIds: ["b1"],
    boards: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
    cards: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" }, { id: "p1" }],
    placements: [
      { boardId: "b1", cardId: "c1" },
      { boardId: "b2", cardId: "c2" },
      { boardId: "b1", cardId: "c3" },
      { boardId: "b2", cardId: "c3" },
      { boardId: "b1", cardId: "p1" },
      { boardId: "b2", cardId: "c4" },
      { boardId: "b2", cardId: "c9" },
    ],
    sections: [
      { id: "s1", boardId: "b1" },
      { id: "s2", boardId: "b2" },
    ],
    edges: [
      { id: "e1", boardId: "b1" },
      { id: "e2", boardId: "b2" },
    ],
    portals: new Map([["b2", "p1"]]),
    ...overrides,
  };
}

describe("planNavigation", () => {
  it("focuses a card on the active board without switching", () => {
    expect(planNavigation({ kind: "card", id: "c1" }, scene())).toEqual({
      kind: "card",
      cardId: "c1",
      boardId: "b1",
      switchBoard: false,
      opensTab: false,
    });
  });

  it("switches to another board to focus a card there", () => {
    expect(planNavigation({ kind: "card", id: "c2" }, scene())).toEqual({
      kind: "card",
      cardId: "c2",
      boardId: "b2",
      switchBoard: true,
      opensTab: true,
    });
  });

  it("prefers the copy on the active board when a card is placed twice", () => {
    expect(planNavigation({ kind: "card", id: "c3" }, scene())).toMatchObject({
      boardId: "b1",
      switchBoard: false,
    });
  });

  it("returns null for a card placed nowhere (not here)", () => {
    expect(planNavigation({ kind: "card", id: "c5" }, scene())).toBeNull();
  });

  it("returns null for a card that no longer exists, even with a stale placement", () => {
    expect(planNavigation({ kind: "card", id: "c9" }, scene())).toBeNull();
  });

  it("returns null for a card placed on a board that no longer exists", () => {
    const sceneWithGhostBoard = scene({
      boards: [{ id: "b1" }, { id: "b2" }],
      placements: [{ boardId: "gone", cardId: "c1" }],
    });
    expect(planNavigation({ kind: "card", id: "c1" }, sceneWithGhostBoard)).toBeNull();
  });

  it("opens a board through its portal on the active board, naming the doorway card", () => {
    expect(planNavigation({ kind: "board", id: "b2" }, scene())).toEqual({
      kind: "board",
      boardId: "b2",
      viaPortal: "p1",
    });
  });

  it("activates a board with no portal on the active board", () => {
    expect(planNavigation({ kind: "board", id: "b3" }, scene())).toEqual({
      kind: "board",
      boardId: "b3",
      viaPortal: null,
    });
  });

  it("returns null for a board that does not exist", () => {
    expect(planNavigation({ kind: "board", id: "nope" }, scene())).toBeNull();
  });

  it("never flies through a doorway to the board already on screen", () => {
    expect(planNavigation({ kind: "board", id: "b1" }, scene())).toEqual({
      kind: "board",
      boardId: "b1",
      viaPortal: null,
    });
  });

  it("ignores a portal when no board is active", () => {
    expect(
      planNavigation({ kind: "board", id: "b2" }, scene({ activeBoardId: null, openBoardIds: [] })),
    ).toEqual({ kind: "board", boardId: "b2", viaPortal: null });
  });

  it("focuses a section on the active board", () => {
    expect(planNavigation({ kind: "section", id: "s1" }, scene())).toEqual({
      kind: "section",
      sectionId: "s1",
      boardId: "b1",
      switchBoard: false,
      opensTab: false,
    });
  });

  it("switches boards to focus a section elsewhere", () => {
    expect(planNavigation({ kind: "section", id: "s2" }, scene())).toEqual({
      kind: "section",
      sectionId: "s2",
      boardId: "b2",
      switchBoard: true,
      opensTab: true,
    });
  });

  it("returns null for a section that does not exist", () => {
    expect(planNavigation({ kind: "section", id: "s9" }, scene())).toBeNull();
  });

  it("selects a link on its own board without switching when already there", () => {
    expect(planNavigation({ kind: "link", id: "e1" }, scene())).toEqual({
      kind: "link",
      edgeId: "e1",
      boardId: "b1",
      switchBoard: false,
      opensTab: false,
    });
  });

  it("switches boards before selecting a link elsewhere", () => {
    expect(planNavigation({ kind: "link", id: "e2" }, scene())).toEqual({
      kind: "link",
      edgeId: "e2",
      boardId: "b2",
      switchBoard: true,
      opensTab: true,
    });
  });

  it("returns null for a link that does not exist", () => {
    expect(planNavigation({ kind: "link", id: "e9" }, scene())).toBeNull();
  });
});

describe("targetOfFocus", () => {
  it("maps a peer's caret to a card target", () => {
    expect(targetOfFocus({ focus: { nodeId: "c1", field: "body" } })).toEqual({
      kind: "card",
      id: "c1",
    });
  });

  it("returns null when the peer is not focusing anything", () => {
    expect(targetOfFocus({ focus: null })).toBeNull();
    expect(targetOfFocus(null)).toBeNull();
  });
});
