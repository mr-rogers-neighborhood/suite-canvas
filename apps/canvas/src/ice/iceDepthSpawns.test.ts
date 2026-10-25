import { WorkspaceDocument } from "@suite/graph";
import type { CanvasEngine, Entity } from "@vibecook/ice";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The depth step, at the spawn table: a link whose frame is an ancestor of the
 * Board the camera is inside is re-drawn *in* that Board, cut at its wall.
 *
 * The kind is mocked (its own tests cover the ink); what is proven here is the
 * decision — which frame, which parent, which coordinates — and that entering
 * and leaving replace the object rather than quietly leaving a stale one.
 */
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("./suiteEdgeKind", () => ({
  SUITE_EDGE_TYPE: "suite.edge",
  suiteEdgeSpawn: (input: {
    edgeId: string;
    kind: string;
    path: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    through?: boolean;
  }) => {
    spawnMock(input);
    return {
      type: "suite.edge",
      x: input.from.x,
      y: input.from.y,
      w: 10,
      h: 1,
      props: {
        edgeId: input.edgeId,
        kind: input.kind,
        path: input.path,
        arrow: false,
        through: input.through === true,
      },
    };
  },
}));

import { spawnLinkEdges } from "./iceSurfaceSpawns";

function fakeEngine() {
  let next = 0;
  const spawned: { entity: Entity; parent: Entity | undefined }[] = [];
  const ops = {
    spawnWidget: vi.fn((_type: string, opts: { parent?: Entity }) => {
      next += 1;
      spawned.push({ entity: next as unknown as Entity, parent: opts.parent });
      return next as unknown as Entity;
    }),
    setSelection: vi.fn(),
    deleteSelection: vi.fn(),
  };
  return { engine: { ops } as unknown as CanvasEngine, ops, spawned };
}

/** The mat entity that stands for a Board on the desk (what a link is a child of). */
const MAT = 900 as unknown as Entity;

/**
 * The View, a Board at (200, 0) sized 300×300, a card inside it and a card on
 * the plane east of both.
 *
 * The inside card's centre is (244, 220) in the Board's own coordinates — the
 * default 288×240 card at (100, 100). The outside card's centre is (844, 220) in
 * world, so it is well past the frame's east wall at x = 500.
 */
function workspaceWithCrossingLink() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const view = workspace.ensureView();
  const board = workspace.createBoard({
    name: "Frame",
    parentBoardId: view.id,
    x: 200,
    y: 0,
    width: 300,
    height: 300,
  });
  const inside = workspace.createCard({ boardId: board.id, position: { x: 100, y: 100 } });
  const outside = workspace.createCard({ boardId: view.id, position: { x: 700, y: 100 } });
  const edge = workspace.addEdge({ boardId: view.id, source: inside.id, target: outside.id });
  if (edge === null) throw new Error("edge");
  const mats = new Map([[MAT, { boardId: board.id, parentBoardId: view.id, title: "Frame" }]]);
  return { workspace, view, board, inside, outside, mats };
}

beforeEach(() => {
  spawnMock.mockClear();
});

describe("crossing links", () => {
  it("should draw on the View's plane while the camera is on it", () => {
    const { workspace, view, mats } = workspaceWithCrossingLink();
    const { engine, ops } = fakeEngine();

    spawnLinkEdges(engine, workspace, view.id, mats, () => {});

    expect(ops.spawnWidget).toHaveBeenCalledTimes(1);
    const input = spawnMock.mock.calls[0]?.[0];
    // World units on the View's plane: the inside card is drawn small inside the
    // frame's face, at its world anchor.
    expect(input.from).toEqual({ x: 444, y: 220 });
    expect(input.to).toEqual({ x: 844, y: 220 });
    expect(input.through).toBe(false);
    expect(ops.spawnWidget.mock.calls[0]?.[1]).not.toHaveProperty("parent");
  });

  it("should re-draw inside the entered Board, cut at the wall it leaves", () => {
    const { workspace, view, board, mats } = workspaceWithCrossingLink();
    const { engine, ops, spawned } = fakeEngine();
    const handle = spawnLinkEdges(engine, workspace, view.id, mats, () => {});

    handle.restage([board.id]);

    // A different parent and different units: the old object is replaced.
    expect(ops.setSelection).toHaveBeenCalled();
    expect(ops.deleteSelection).toHaveBeenCalled();
    expect(ops.spawnWidget).toHaveBeenCalledTimes(2);
    const input = spawnMock.mock.calls[1]?.[0];
    // Both anchors are in the Board's own coordinates: the outside card is at
    // x = 644 there, so the segment stops at the east wall at x = 300.
    expect(input.from).toEqual({ x: 244, y: 220 });
    expect(input.to).toEqual({ x: 300, y: 220 });
    expect(input.through).toBe(true);
    // The object is the entered mat's child, so the camera inside draws it.
    expect(ops.spawnWidget.mock.calls[1]?.[1]).toMatchObject({ parent: MAT });

    const drawn = handle.debug();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.frame).toBe(board.id);
    expect(drawn[0]?.to).toEqual({ x: 300, y: 220 });
    // The entity that replaced it, not the one the plane held.
    expect(drawn[0]?.entity).toBe(spawned[1]?.entity);
  });

  it("should put the link back on its plane when the Board is left", () => {
    const { workspace, view, board, mats } = workspaceWithCrossingLink();
    const { engine, ops } = fakeEngine();
    const handle = spawnLinkEdges(engine, workspace, view.id, mats, () => {});

    handle.restage([board.id]);
    handle.restage([]);

    expect(ops.spawnWidget).toHaveBeenCalledTimes(3);
    const input = spawnMock.mock.calls[2]?.[0];
    expect(input.from).toEqual({ x: 444, y: 220 });
    expect(input.to).toEqual({ x: 844, y: 220 });
    expect(input.through).toBe(false);
    expect(ops.spawnWidget.mock.calls[2]?.[1]).not.toHaveProperty("parent");
    expect(handle.debug()[0]?.frame).toBe(view.id);
  });

  it("should not churn when the entered path is the one it already drew", () => {
    const { workspace, view, board, mats } = workspaceWithCrossingLink();
    const { engine, ops } = fakeEngine();
    const handle = spawnLinkEdges(engine, workspace, view.id, mats, () => {});

    handle.restage([board.id]);
    handle.restage([board.id]);
    expect(ops.spawnWidget).toHaveBeenCalledTimes(2);
  });
});

describe("links the entered Board already owns", () => {
  it("should draw a same-Board link inside it, with no tick", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const view = workspace.ensureView();
    const board = workspace.createBoard({
      name: "Frame",
      parentBoardId: view.id,
      x: 200,
      y: 0,
      width: 600,
      height: 400,
    });
    const first = workspace.createCard({ boardId: board.id, position: { x: 20, y: 40 } });
    const second = workspace.createCard({ boardId: board.id, position: { x: 300, y: 40 } });
    workspace.addEdge({ boardId: view.id, source: first.id, target: second.id });
    const mats = new Map([[MAT, { boardId: board.id, parentBoardId: view.id, title: "Frame" }]]);
    const { engine, ops } = fakeEngine();

    const handle = spawnLinkEdges(engine, workspace, view.id, mats, () => {});
    handle.restage([board.id]);

    // It was already the mat's child: entering changes nothing at all.
    expect(ops.spawnWidget).toHaveBeenCalledTimes(1);
    const input = spawnMock.mock.calls[0]?.[0];
    expect(input.from).toEqual({ x: 164, y: 160 });
    expect(input.to).toEqual({ x: 444, y: 160 });
    expect(input.through).toBe(false);
    expect(ops.spawnWidget.mock.calls[0]?.[1]).toMatchObject({ parent: MAT });
  });

  it("should leave a link whose end is the entered Board's own wall uncut", () => {
    const { workspace, view, board, mats } = workspaceWithCrossingLink();
    const inside = workspace
      .listPlacements()
      .find((placement) => placement.boardId === board.id)?.cardId;
    if (inside === undefined) throw new Error("no card inside the frame");
    workspace.addEdge({
      boardId: view.id,
      source: inside,
      target: board.id,
      targetKind: "board",
    });
    const { engine } = fakeEngine();

    const handle = spawnLinkEdges(engine, workspace, view.id, mats, () => {});
    handle.restage([board.id]);

    // The crossing card-to-card link plus the frame end, both drawn in the frame.
    const wanted = workspace
      .listSubtreeEdges(view.id)
      .find((candidate) => candidate.targetKind === "board");
    if (wanted === undefined) throw new Error("no frame end");
    const frameEnd = spawnMock.mock.calls
      .map((call) => call[0])
      .filter((input) => input.edgeId === wanted.id)
      .pop();
    // The wall the frame leaves by faces the card, so the end *is* the wall: it
    // sits on x = 300 and nothing was cut, so there is no tick.
    expect(frameEnd?.to).toEqual({ x: 300, y: 150 });
    expect(frameEnd?.through).toBe(false);
    const frameEdge = handle.debug().find((edge) => edge.edgeId === wanted.id);
    expect(frameEdge?.frame).toBe(board.id);
    expect(frameEdge?.to).toEqual({ x: 300, y: 150 });
  });
});
