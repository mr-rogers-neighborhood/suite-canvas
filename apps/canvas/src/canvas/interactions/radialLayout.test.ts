import type { GraphEdge, Placement, Section } from "@suite/graph";
import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import {
  allCapabilities,
  type CommandActions,
  type CommandContext,
  commandsFor,
  paletteInvocations,
} from "../../command/commandRegistry";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./multiSelect";
import {
  childrenFromLinks,
  planRadial,
  RADIAL_RING_GAP,
  RADIAL_START_ANGLE,
  type RadialInput,
  radialSlots,
} from "./radialLayout";

function placement(cardId: string, x: number, y: number): Placement {
  return { boardId: "board-1", cardId, x, y, z: 0, createdAt: 0 };
}

function input(overrides: Partial<RadialInput> = {}): RadialInput {
  return {
    boardId: "board-1",
    rootCardId: "root",
    children: new Map([
      ["root", ["a", "b"]],
      ["a", ["a1"]],
    ]),
    placements: [
      placement("root", 0, 0),
      placement("a", 900, 900),
      placement("b", 900, 900),
      placement("a1", 900, 900),
    ],
    ...overrides,
  };
}

const centre = {
  x: DEFAULT_CARD_WIDTH / 2,
  y: DEFAULT_CARD_HEIGHT / 2,
};

describe("radialSlots", () => {
  it("should give every reachable card a depth and an angle", () => {
    const slots = radialSlots(input());
    expect(slots.map((slot) => [slot.cardId, slot.depth])).toEqual([
      ["a", 1],
      ["b", 1],
      ["a1", 2],
    ]);
  });

  it("should place the first child at the start angle", () => {
    const slots = radialSlots(input({ children: new Map([["root", ["a"]]]) }));
    expect(slots).toHaveLength(1);
    expect(slots[0]?.angle).toBeCloseTo(RADIAL_START_ANGLE + Math.PI);
  });

  it("should survive a cycle without repeating a card", () => {
    const slots = radialSlots(
      input({
        children: new Map([
          ["root", ["a"]],
          ["a", ["root", "b"]],
          ["b", ["root"]],
        ]),
      }),
    );
    expect(slots.map((slot) => slot.cardId)).toEqual(["a", "b"]);
  });

  it("should give a wide branch a wider arc than a narrow one", () => {
    const slots = radialSlots(
      input({
        children: new Map([
          ["root", ["wide", "narrow"]],
          ["wide", ["w1", "w2", "w3"]],
        ]),
      }),
    );
    const wide = slots.find((slot) => slot.cardId === "wide");
    const narrow = slots.find((slot) => slot.cardId === "narrow");
    if (!wide || !narrow) throw new Error("expected both branches");
    // The wide branch owns three quarters of the circle, so its children spread further.
    const children = slots.filter((slot) => slot.depth === 2);
    const spread = Math.abs(
      (children[0]?.angle ?? 0) - (children[children.length - 1]?.angle ?? 0),
    );
    expect(spread).toBeGreaterThan(Math.PI / 4);
    expect(wide.depth).toBe(1);
    expect(narrow.depth).toBe(1);
  });
});

describe("planRadial", () => {
  it("should leave the root exactly where the reader put it", () => {
    const plan = planRadial(input());
    expect(plan?.placements.map((entry) => entry.cardId)).not.toContain("root");
  });

  it("should put the first ring one gap from the root", () => {
    const plan = planRadial(input({ children: new Map([["root", ["a"]]]) }));
    const placed = plan?.placements.find((entry) => entry.cardId === "a");
    if (!placed) throw new Error("expected a placement for the first child");
    // A single child owns the whole circle, so it lands opposite the start angle:
    // the ring starts at twelve o'clock, so one child sits at six.
    expect(placed.x).toBeCloseTo(centre.x - DEFAULT_CARD_WIDTH / 2);
    expect(placed.y).toBeCloseTo(centre.y + RADIAL_RING_GAP - DEFAULT_CARD_HEIGHT / 2);
  });

  it("should put a grandchild on the second ring", () => {
    const plan = planRadial(input());
    const grandchild = plan?.placements.find((entry) => entry.cardId === "a1");
    if (!grandchild) throw new Error("expected a placement for the grandchild");
    const distance = Math.hypot(
      grandchild.x + DEFAULT_CARD_WIDTH / 2 - centre.x,
      grandchild.y + DEFAULT_CARD_HEIGHT / 2 - centre.y,
    );
    expect(distance).toBeCloseTo(RADIAL_RING_GAP * 2, 5);
  });

  it("should name only the board it arranged", () => {
    expect(planRadial(input())?.boards).toEqual(["board-1"]);
  });

  it("should do nothing when the root is not on this board", () => {
    expect(planRadial(input({ placements: [] }))).toBeNull();
  });

  it("should do nothing when the root has no branch", () => {
    expect(planRadial(input({ children: new Map() }))).toBeNull();
  });

  it("should grow a section around the cards it now holds", () => {
    const section: Section = {
      id: "section-1",
      boardId: "board-1",
      title: "Branch",
      x: 0,
      y: -100,
      width: 10,
      height: 10,
      z: 0,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const plan = planRadial(input({ sections: [section] }));
    expect(plan?.sections?.map((entry) => entry.sectionId)).toEqual(["section-1"]);
    expect(plan?.sections?.[0]?.width).toBeGreaterThan(10);
  });

  it("should land as one undoable step in a real document", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const root = workspace.createCard({
      boardId: board.id,
      position: { x: 0, y: 0 },
      typeId: "note",
    });
    const child = workspace.createCard({
      boardId: board.id,
      position: { x: 900, y: 900 },
      typeId: "note",
    });
    const grandchild = workspace.createCard({
      boardId: board.id,
      position: { x: 900, y: 900 },
      typeId: "note",
    });

    const plan = planRadial({
      boardId: board.id,
      rootCardId: root.id,
      children: new Map([
        [root.id, [child.id]],
        [child.id, [grandchild.id]],
      ]),
      placements: workspace.listBoardPlacements(board.id),
    });
    if (!plan) throw new Error("expected a plan");

    const before = workspace.getPlacement(board.id, grandchild.id)?.x;
    // One step for the layout, separate from the cards that made the fixture.
    workspace.stopCapturing();
    workspace.applyLayoutPlan(plan);
    expect(workspace.getPlacement(board.id, child.id)?.x).not.toBe(900);
    expect(workspace.getPlacement(board.id, grandchild.id)?.x).not.toBe(before);

    workspace.stopCapturing();
    workspace.undo();
    expect(workspace.getPlacement(board.id, child.id)?.x).toBe(900);
  });
});

describe("childrenFromLinks", () => {
  function edge(source: string, target: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
    return {
      id: `${source}-${target}`,
      boardId: "board-1",
      source,
      target,
      kind: "references",
      path: "bezier",
      bidirectional: false,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as GraphEdge;
  }

  it("should read a card link and a mention as children", () => {
    const children = childrenFromLinks({
      boardId: "board-1",
      edges: [edge("root", "a")],
      references: { root: ["b"] },
    });
    expect(children.get("root")).toEqual(["a", "b"]);
  });

  it("should ignore a link drawn on another board", () => {
    const children = childrenFromLinks({
      boardId: "board-1",
      edges: [edge("root", "a", { boardId: "board-2" })],
    });
    expect(children.get("root")).toBeUndefined();
  });

  it("should ignore a portal link and a card that points at itself", () => {
    const children = childrenFromLinks({
      boardId: "board-1",
      edges: [edge("root", "board-2", { targetKind: "board" }), edge("root", "root")],
    });
    expect(children.get("root")).toBeUndefined();
  });

  it("should follow a bidirectional link both ways once", () => {
    const children = childrenFromLinks({
      boardId: "board-1",
      edges: [edge("a", "b", { bidirectional: true }), edge("b", "a")],
    });
    expect(children.get("a")).toEqual(["b"]);
    expect(children.get("b")).toEqual(["a"]);
  });
});

describe("the command that runs it", () => {
  const context = (arrangeRadial?: () => void, cardId: string | null = "root"): CommandContext => ({
    capabilities: allCapabilities,
    state: {
      workspaceSurface: true,
      readOnly: false,
      paletteOpen: false,
      libraryOpen: false,
      libraryTab: "cards",
      activeBoardId: "board-1",
      activeViewId: null,
      cardId,
      cardPlaced: true,
      boards: [{ id: "board-1", name: "Board 1" }],
      views: [],
      sections: [],
      cards: [{ id: "root", title: "Root", typeName: "note" }],
      types: [{ id: "note", name: "note" }],
      trashedCount: 0,
    },
    actions: {
      ...({} as CommandActions),
      arrangeRadial,
    } as CommandActions,
  });

  it("should be listed only where the board supplied a handler", () => {
    expect(commandsFor("canvas", context(vi.fn())).map((entry) => entry.id)).toContain(
      "layout.arrangeRadial",
    );
    expect(commandsFor("canvas", context(undefined)).map((entry) => entry.id)).not.toContain(
      "layout.arrangeRadial",
    );
  });

  it("should reach the palette as well as the dock", () => {
    const rows = paletteInvocations(context(vi.fn()));
    expect(rows.map((row) => row.commandId)).toContain("layout.arrangeRadial");
  });

  it("should run the one handler the board owns", () => {
    const arrangeRadial = vi.fn();
    const [row] = paletteInvocations(context(arrangeRadial)).filter(
      (entry) => entry.commandId === "layout.arrangeRadial",
    );
    if (!row) throw new Error("expected a palette row");
    row.run();
    expect(arrangeRadial).toHaveBeenCalledTimes(1);
  });

  it("should wait for a selected card, which is the root", () => {
    expect(paletteInvocations(context(vi.fn(), null)).map((row) => row.commandId)).not.toContain(
      "layout.arrangeRadial",
    );
  });
});
