import { WorkspaceDocument } from "@suite/graph";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RADIAL_RING_GAP } from "../canvas/interactions/radialLayout";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useBoardPaletteActions } from "./useBoardPaletteActions";

/**
 * The rows the shell hands the palette, run against a real document.
 *
 * `palette.test.ts` proves each row reaches its handler; this proves the handler
 * does what the row promises: rings for the selected card's subtree, one undo step
 * per change, and an install panel opened on the card the reader has in front.
 */

function seeded(): { workspace: WorkspaceDocument; board: string; root: string; child: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  // Both cards start in the same place, so a radial plan has to move the child.
  const root = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const child = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText(root.id, "Root");
  workspace.setTitleText(child.id, "Branch");
  workspace.addEdge({ boardId: board.id, source: root.id, target: child.id });
  return { workspace, board: board.id, root: root.id, child: child.id };
}

function placement(workspace: WorkspaceDocument, boardId: string, cardId: string) {
  const found = workspace.listCardPlacements(cardId).find((entry) => entry.boardId === boardId);
  if (!found) throw new Error("no placement");
  return found;
}

beforeEach(() => {
  useUiStore.setState({
    activeBoardId: null,
    selectedNodeIds: [],
    canEditLayout: true,
    blueprintCardId: null,
  });
});

describe("useBoardPaletteActions", () => {
  it("arranges the selected card's links on a ring, and undoes as one step", () => {
    const { workspace, board, root, child } = seeded();
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ activeBoardId: board, selectedNodeIds: [root] });

    const { result } = renderHook(() => useBoardPaletteActions());
    expect(placement(workspace, board, child).y).toBe(0);

    act(() => result.current.arrangeRadial());
    // One ring out from the root's centre — the gap is the planner's, so the
    // assertion names it — and the root itself never moves.
    const arranged = placement(workspace, board, child).y;
    expect(Math.abs(arranged)).toBe(RADIAL_RING_GAP);
    expect(placement(workspace, board, root).y).toBe(0);

    act(() => result.current.undo());
    expect(placement(workspace, board, child).y).toBe(0);
    expect(useUiStore.getState().selectedNodeIds).toEqual([]);

    act(() => result.current.redo());
    expect(placement(workspace, board, child).y).toBe(arranged);
  });

  it("does nothing without a card in the selection", () => {
    const { workspace, board, child } = seeded();
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ activeBoardId: board, selectedNodeIds: [] });

    const { result } = renderHook(() => useBoardPaletteActions());
    act(() => result.current.arrangeRadial());

    expect(placement(workspace, board, child).y).toBe(0);
  });

  it("opens the install panel on the card the palette named", () => {
    const { workspace, root } = seeded();
    useCanvasStore.setState({ workspace });

    const { result } = renderHook(() => useBoardPaletteActions());
    act(() => result.current.installBlueprint(root));

    expect(useUiStore.getState().blueprintCardId).toBe(root);
  });
});
