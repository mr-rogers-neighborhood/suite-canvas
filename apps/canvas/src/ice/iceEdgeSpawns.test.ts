import { WorkspaceDocument } from "@suite/graph";
import type { CanvasEngine, Entity } from "@vibecook/ice";
import { describe, expect, it, vi } from "vitest";

/**
 * The surface's own suite mocks the edge kind, so the two facts that matter for
 * links are proven here: a link leaves the connector it names (not the card's
 * centre), and a link that left the document leaves the desk.
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
    arrow: boolean;
  }) => {
    spawnMock(input);
    return {
      type: "suite.edge",
      x: input.from.x,
      y: input.from.y,
      w: 10,
      h: 1,
      props: { edgeId: input.edgeId, kind: input.kind, path: input.path, arrow: input.arrow },
    };
  },
}));

import { spawnLinkEdges } from "./IceSurface";

function fakeEngine() {
  let next = 0;
  const ops = {
    spawnWidget: vi.fn((_type: string, _opts: unknown) => {
      next += 1;
      return next as unknown as Entity;
    }),
    setSelection: vi.fn(),
    deleteSelection: vi.fn(),
  };
  return { engine: { ops } as unknown as CanvasEngine, ops };
}

function workspaceWithCards() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const view = workspace.ensureView();
  const a = workspace.createCard({ boardId: view.id, position: { x: 100, y: 50 } });
  const b = workspace.createCard({ boardId: view.id, position: { x: 500, y: 50 } });
  const east = a.connectors.find((connector) => connector.x === 1 && connector.y === 0.5);
  const west = b.connectors.find((connector) => connector.x === 0 && connector.y === 0.5);
  if (east === undefined || west === undefined) throw new Error("default connectors missing");
  return { workspace, view, a, b, east, west };
}

function workspaceWithBoard() {
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
  const card = workspace.createCard({ boardId: view.id, position: { x: 700, y: 100 } });
  return { workspace, view, board, card };
}

describe("spawnLinkEdges", () => {
  it("draws a link to a Board from the wall facing the other end", () => {
    const { workspace, view, board, card } = workspaceWithBoard();
    workspace.addEdge({
      boardId: view.id,
      source: card.id,
      target: board.id,
      targetKind: "board",
    });
    const { engine } = fakeEngine();

    spawnLinkEdges(engine, workspace, view.id, new Map(), () => {});

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const input = spawnMock.mock.calls[0]?.[0];
    // The card sits east of the frame, so the frame's east wall takes the end,
    // at its middle — a frame has no perimeter to hang a connector on.
    expect(input.to).toEqual({ x: 500, y: 150 });
    expect(input.from).toEqual({ x: 700 + 144, y: 100 + 120 });
  });

  it("links two frames wall to wall", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const view = workspace.ensureView();
    const left = workspace.createBoard({
      name: "Left",
      parentBoardId: view.id,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const right = workspace.createBoard({
      name: "Right",
      parentBoardId: view.id,
      x: 800,
      y: 0,
      width: 200,
      height: 200,
    });
    workspace.addEdge({
      boardId: view.id,
      source: left.id,
      sourceKind: "board",
      target: right.id,
      targetKind: "board",
    });
    const { engine } = fakeEngine();

    spawnLinkEdges(engine, workspace, view.id, new Map(), () => {});

    const input = spawnMock.mock.calls[0]?.[0];
    expect(input.from).toEqual({ x: 200, y: 100 });
    expect(input.to).toEqual({ x: 800, y: 100 });
  });

  it("draws a link from the connectors it names, not the card centres", () => {
    const { workspace, view, a, b, east, west } = workspaceWithCards();
    workspace.addEdge({
      boardId: view.id,
      source: a.id,
      target: b.id,
      sourceConnector: east.id,
      targetConnector: west.id,
    });
    const { engine } = fakeEngine();

    spawnLinkEdges(engine, workspace, view.id, new Map(), () => {});

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const input = spawnMock.mock.calls[0]?.[0];
    // East midpoint of card a at (100, 50), west midpoint of card b at (500, 50).
    expect(input.from).toEqual({ x: 100 + 288, y: 50 + 120 });
    expect(input.to).toEqual({ x: 500, y: 50 + 120 });
  });

  it("adds only the links that arrived, and reaps the ones that left", () => {
    const { workspace, view, a, b, east, west } = workspaceWithCards();
    const first = workspace.addEdge({
      boardId: view.id,
      source: a.id,
      target: b.id,
      sourceConnector: east.id,
      targetConnector: west.id,
    });
    if (first === null) throw new Error("edge");
    const { engine, ops } = fakeEngine();
    const remove = vi.fn();

    const handle = spawnLinkEdges(engine, workspace, view.id, new Map(), () => {});
    expect(ops.spawnWidget).toHaveBeenCalledTimes(1);

    // Nothing changed: a second sync is not a second link.
    handle.sync(remove);
    expect(ops.spawnWidget).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    // A peer deletes it: the entity goes with it.
    workspace.removeEdge(first.id);
    handle.sync(remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(1);
  });

  it("does not draw a link whose end is not placed", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const view = workspace.ensureView();
    const placed = workspace.createCard({ boardId: view.id, position: { x: 0, y: 0 } });
    const unplaced = workspace.createCard({});
    workspace.addEdge({ boardId: view.id, source: placed.id, target: unplaced.id });
    const { engine, ops } = fakeEngine();

    spawnLinkEdges(engine, workspace, view.id, new Map(), () => {});

    expect(ops.spawnWidget).not.toHaveBeenCalled();
  });
});
