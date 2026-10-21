import {
  type Board,
  type Card,
  type GraphEdge,
  type Placement,
  WorkspaceDocument,
} from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { applyWorkspaceChange } from "./snapshotChanges";
import type { WorkspaceSnapshot } from "./snapshotMerge";

const card = (id: string, updatedAt = 0): Card => ({
  id,
  kind: "note",
  createdAt: 0,
  updatedAt,
  connectors: [],
  deletedAt: null,
  data: {},
});

const board = (id: string, createdAt = 0): Board => ({
  id,
  name: id,
  createdAt,
  updatedAt: createdAt,
});

const placement = (
  boardId: string,
  cardId: string,
  overrides: Partial<Placement> = {},
): Placement => ({
  boardId,
  cardId,
  x: 0,
  y: 0,
  z: 0,
  createdAt: 0,
  ...overrides,
});

const edge = (id: string, updatedAt = 0): GraphEdge => ({
  id,
  boardId: "b1",
  source: "a",
  target: "b",
  kind: "references",
  path: "bezier",
  bidirectional: false,
  createdAt: 0,
  updatedAt,
});

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return { boards: [], cards: [], placements: [], edges: [], ...overrides };
}

describe("applyWorkspaceChange", () => {
  it("should append a new card and keep untouched collections stable", () => {
    const base = snapshot({ cards: [card("a")] });
    const added = card("b");

    const next = applyWorkspaceChange(base, {
      section: "cards",
      action: "add",
      key: "b",
      value: added,
    });

    expect(next.cards).toHaveLength(2);
    expect(next.cards[0]).toBe(base.cards[0]);
    expect(next.cards[1]).toBe(added);
    expect(next.boards).toBe(base.boards);
    expect(next.placements).toBe(base.placements);
    expect(next.edges).toBe(base.edges);
    expect(next).not.toBe(base);
  });

  it("should replace an updated card in place", () => {
    const base = snapshot({ cards: [card("a"), card("b"), card("c")] });
    const updated = card("b", 42);

    const next = applyWorkspaceChange(base, {
      section: "cards",
      action: "update",
      key: "b",
      value: updated,
    });

    expect(next.cards).toHaveLength(3);
    expect(next.cards[0]).toBe(base.cards[0]);
    expect(next.cards[1]).toBe(updated);
    expect(next.cards[2]).toBe(base.cards[2]);
  });

  it("should remove a deleted card and leave the others in place", () => {
    const base = snapshot({ cards: [card("a"), card("b"), card("c")] });

    const next = applyWorkspaceChange(base, {
      section: "cards",
      action: "delete",
      key: "b",
      value: null,
    });

    expect(next.cards.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(next.cards[0]).toBe(base.cards[0]);
    expect(next.cards[1]).toBe(base.cards[2]);
  });

  it("should treat a null value as a removal", () => {
    const base = snapshot({ cards: [card("a"), card("b")] });

    const next = applyWorkspaceChange(base, {
      section: "cards",
      action: "update",
      key: "a",
      value: null,
    });

    expect(next.cards.map((entry) => entry.id)).toEqual(["b"]);
    expect(next.cards[0]).toBe(base.cards[1]);
  });

  it("should return the same snapshot when the record reference did not move", () => {
    const base = snapshot({ cards: [card("a")] });
    const unchanged = base.cards[0] as Card;

    expect(
      applyWorkspaceChange(base, {
        section: "cards",
        action: "update",
        key: "a",
        value: unchanged,
      }),
    ).toBe(base);
  });

  it("should ignore a delete for a record the snapshot did not hold", () => {
    const base = snapshot({ edges: [edge("e1")] });

    expect(
      applyWorkspaceChange(base, { section: "edges", action: "delete", key: "e2", value: null }),
    ).toBe(base);
  });

  it("should keep boards sorted by createdAt then id", () => {
    const base = snapshot({ boards: [board("b", 10), board("d", 20)] });

    const next = applyWorkspaceChange(base, {
      section: "boards",
      action: "add",
      key: "c",
      value: board("c", 15),
    });

    expect(next.boards.map((entry) => entry.id)).toEqual(["b", "c", "d"]);
  });

  it("should break createdAt ties by board id", () => {
    const base = snapshot({ boards: [board("a", 10), board("c", 10)] });

    const next = applyWorkspaceChange(base, {
      section: "boards",
      action: "add",
      key: "b",
      value: board("b", 10),
    });

    expect(next.boards.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("should re-sort a board whose createdAt moved", () => {
    const base = snapshot({ boards: [board("a", 10), board("b", 20)] });

    const next = applyWorkspaceChange(base, {
      section: "boards",
      action: "update",
      key: "a",
      value: board("a", 30),
    });

    expect(next.boards.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("should update a board in place when its sort key is unchanged", () => {
    const base = snapshot({ boards: [board("a", 10), board("b", 20)] });
    const renamed: Board = { ...board("a", 10), name: "Renamed" };

    const next = applyWorkspaceChange(base, {
      section: "boards",
      action: "update",
      key: "a",
      value: renamed,
    });

    expect(next.boards[0]).toBe(renamed);
    expect(next.boards[1]).toBe(base.boards[1]);
  });

  it("should remove a deleted board", () => {
    const base = snapshot({ boards: [board("a", 10), board("b", 20)] });

    const next = applyWorkspaceChange(base, {
      section: "boards",
      action: "delete",
      key: "a",
      value: null,
    });

    expect(next.boards.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("should key placements by board and card", () => {
    const first = placement("b1", "c1");
    const second = placement("b2", "c1");
    const base = snapshot({ placements: [first, second] });
    const moved = placement("b2", "c1", { x: 40 });

    const next = applyWorkspaceChange(base, {
      section: "placements",
      action: "update",
      key: "b2/c1",
      value: moved,
    });

    expect(next.placements).toHaveLength(2);
    expect(next.placements[0]).toBe(first);
    expect(next.placements[1]).toBe(moved);
  });

  it("should append and delete placements by their board and card key", () => {
    const first = placement("b1", "c1");
    const base = snapshot({ placements: [first] });
    const added = placement("b1", "c2", { x: 24 });

    const withAdded = applyWorkspaceChange(base, {
      section: "placements",
      action: "add",
      key: "b1/c2",
      value: added,
    });
    const withRemoved = applyWorkspaceChange(withAdded, {
      section: "placements",
      action: "delete",
      key: "b1/c1",
      value: null,
    });

    expect(withAdded.placements[1]).toBe(added);
    expect(withRemoved.placements).toEqual([added]);
    expect(withAdded.cards).toBe(base.cards);
  });

  it("should append, update and delete edges by id", () => {
    const base = snapshot({ edges: [edge("e1")] });
    const added = edge("e2");

    const withAdded = applyWorkspaceChange(base, {
      section: "edges",
      action: "add",
      key: "e2",
      value: added,
    });
    const updated = edge("e2", 7);
    const withUpdated = applyWorkspaceChange(withAdded, {
      section: "edges",
      action: "update",
      key: "e2",
      value: updated,
    });
    const withRemoved = applyWorkspaceChange(withUpdated, {
      section: "edges",
      action: "delete",
      key: "e1",
      value: null,
    });

    expect(withAdded.edges[1]).toBe(added);
    expect(withUpdated.edges[1]).toBe(updated);
    expect(withRemoved.edges).toEqual([updated]);
  });
});

describe("applyWorkspaceChange over WorkspaceDocument.observe", () => {
  it("should reproduce a full read after structural edits", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    const read = (): WorkspaceSnapshot => ({
      boards: workspace.listBoards(),
      cards: workspace.listCards(),
      placements: workspace.listPlacements(),
      edges: workspace.listEdges(),
    });

    let snapshot = read();
    const stop = workspace.observe((change) => {
      snapshot = applyWorkspaceChange(snapshot, change);
    });

    const board = workspace.createBoard({ id: "b1", name: "One" });
    const second = workspace.createBoard({ id: "b2", name: "Two" });
    const first = workspace.createCard({ id: "c1", boardId: board.id, position: { x: 4, y: 5 } });
    const other = workspace.createCard({ id: "c2", boardId: board.id });
    workspace.placeCard(second.id, first.id, { x: 10, y: 20 });
    workspace.updatePlacementPosition(board.id, first.id, { x: 7, y: 8 });
    workspace.addEdge({ boardId: board.id, source: first.id, target: other.id });
    workspace.trashCard(other.id);
    workspace.unplaceCard(board.id, first.id);
    workspace.renameBoard(board.id, "Renamed");
    workspace.deleteBoard(second.id);
    stop();

    expect(snapshot).toEqual(read());
  });

  it("should follow updates that arrive from a synced peer", () => {
    const docA = new LoroDoc();
    const docB = new LoroDoc();
    const local = new WorkspaceDocument(docA);
    const remote = new WorkspaceDocument(docB);
    const board = local.createBoard({ id: "b1", name: "One" });
    const card = local.createCard({ id: "c1", boardId: board.id });
    docB.import(docA.export({ mode: "update" }));

    const read = (): WorkspaceSnapshot => ({
      boards: remote.listBoards(),
      cards: remote.listCards(),
      placements: remote.listPlacements(),
      edges: remote.listEdges(),
    });

    let snapshot = read();
    const stop = remote.observe((change) => {
      snapshot = applyWorkspaceChange(snapshot, change);
    });

    local.updatePlacementPosition(board.id, card.id, { x: 12, y: 34 });
    local.renameBoard(board.id, "Renamed");
    local.trashCard(card.id);
    docB.import(docA.export({ mode: "update" }));
    stop();

    expect(snapshot).toEqual(read());
    expect(snapshot.placements[0]).toMatchObject({ x: 12, y: 34 });
  });
});
