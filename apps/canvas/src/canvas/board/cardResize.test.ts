import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { commitCardResize } from "./cardResize";

describe("commitCardResize", () => {
  it("updates placement geometry directly when no neighbor collision occurs", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const cardA = workspace.createCard({ boardId: board.id, position: { x: 100, y: 100 } });
    const cardB = workspace.createCard({ boardId: board.id, position: { x: 600, y: 100 } });

    // Resize card A moderately (width 200 -> 250, still far from card B at 600)
    commitCardResize(workspace, board.id, cardA.id, {
      x: 100,
      y: 100,
      width: 250,
      height: 160,
    });

    const placementA = workspace.getPlacement(board.id, cardA.id);
    const placementB = workspace.getPlacement(board.id, cardB.id);

    expect(placementA?.width).toBe(250);
    expect(placementB?.x).toBe(600);
  });

  it("atomically displaces colliding neighbors in a single undo step when resizing outward", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const cardA = workspace.createCard({ boardId: board.id, position: { x: 100, y: 100 } });
    const cardB = workspace.createCard({ boardId: board.id, position: { x: 324, y: 100 } });

    // Card A is resized to width 350, reaching x = 450 and colliding with Card B at 324
    commitCardResize(workspace, board.id, cardA.id, {
      x: 100,
      y: 100,
      width: 350,
      height: 160,
    });

    const placementA = workspace.getPlacement(board.id, cardA.id);
    const placementB = workspace.getPlacement(board.id, cardB.id);

    expect(placementA?.width).toBe(350);
    // Card B pushed right to: 100 + 350 + 24 (default gap) = 474
    expect(placementB?.x).toBe(474);

    // Single undo step restores both
    workspace.undo();

    const restoredA = workspace.getPlacement(board.id, cardA.id);
    const restoredB = workspace.getPlacement(board.id, cardB.id);

    expect(restoredA?.width).not.toBe(350);
    expect(restoredB?.x).toBe(324);
  });

  it("elastically expands section container when resized card pushes neighbor outside", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();

    const section = workspace.createSection({
      boardId: board.id,
      title: "Active Sprint",
      color: "blue",
      x: 50,
      y: 50,
      width: 400,
      height: 300,
    });

    const cardA = workspace.createCard({ boardId: board.id, position: { x: 80, y: 80 } });
    const cardB = workspace.createCard({ boardId: board.id, position: { x: 80, y: 200 } });

    // Card A is resized downward from height 100 to 250
    // Card B was at y=200, height 160 -> now pushed down to: 80 + 250 + 24 = 354
    // Card B bottom is 354 + 160 = 514, exceeding section bottom (50 + 300 = 350)
    commitCardResize(workspace, board.id, cardA.id, {
      x: 80,
      y: 80,
      width: 280,
      height: 250,
    });

    const updatedSec = workspace.getSection(section.id);
    expect(updatedSec).toBeDefined();
    // Card B was pushed down to y = 354
    expect(workspace.getPlacement(board.id, cardB.id)?.y).toBe(354);
    // Section height expands to fit displaced Card B with padding (24)
    // maxBottom (514) + padding (24) - newY (50) = 488
    expect(updatedSec?.height).toBe(488);

    // Undo restores section, card A, and card B together
    workspace.undo();
    const restoredSec = workspace.getSection(section.id);
    expect(restoredSec?.height).toBe(300);
    expect(workspace.getPlacement(board.id, cardB.id)?.y).toBe(200);
  });
});
