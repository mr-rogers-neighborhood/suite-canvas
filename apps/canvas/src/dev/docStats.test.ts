import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDocStats } from "./docStats";

describe("readDocStats", () => {
  it("should count every record and report an encoded size", () => {
    const workspace = new WorkspaceDocument(new Y.Doc());
    const board = workspace.createBoard({ id: "b1" });
    const card = workspace.createCard({ id: "c1", boardId: board.id });
    const second = workspace.createCard({ id: "c2", boardId: board.id });
    workspace.addEdge({ boardId: board.id, source: card.id, target: second.id });

    const stats = readDocStats(workspace);

    expect(stats.boards).toBe(1);
    expect(stats.cards).toBe(2);
    expect(stats.placements).toBe(2);
    expect(stats.edges).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });
});
