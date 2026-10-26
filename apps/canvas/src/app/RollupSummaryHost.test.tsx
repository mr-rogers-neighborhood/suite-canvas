import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { RollupSummaryHost } from "./RollupSummaryHost";

/**
 * The rollup rail.
 *
 * The rail is the visible half of the collapse flag: pressing its toggle reads the
 * card in front of the reader, the header prints the count `cardRollup` counted, and
 * a member row is the way back to that card.
 */

function seeded(): { workspace: WorkspaceDocument; board: string; root: string; branch: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const root = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const branch = workspace.createCard({ boardId: board.id, position: { x: 500, y: 0 } });
  workspace.setTitleText(root.id, "Root");
  workspace.setTitleText(branch.id, "Branch");
  workspace.addEdge({ boardId: board.id, source: root.id, target: branch.id });
  return { workspace, board: board.id, root: root.id, branch: branch.id };
}

beforeEach(() => {
  useUiStore.setState({
    rollupOpen: false,
    activeBoardId: null,
    selectedNodeIds: [],
    cardFocusId: null,
    inspectorNodeId: null,
    focusTarget: null,
  });
});

describe("RollupSummaryHost", () => {
  it("stays shut until its toggle is pressed, then counts what the card hides", () => {
    const { workspace, board, root } = seeded();
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ activeBoardId: board, selectedNodeIds: [root] });

    render(<RollupSummaryHost workspace={workspace} />);
    expect(screen.queryByTestId("rollup-summary")).toBeNull();

    fireEvent.click(screen.getByTestId("rollup-toggle"));

    expect(screen.getByTestId("rollup-summary")).toBeInTheDocument();
    expect(screen.getByTestId("rollup-count")).toHaveTextContent("1 card");
    expect(useUiStore.getState().rollupOpen).toBe(true);
  });

  it("opens the card a member row names", () => {
    const { workspace, board, root, branch } = seeded();
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ activeBoardId: board, selectedNodeIds: [root], rollupOpen: true });

    render(<RollupSummaryHost workspace={workspace} />);
    fireEvent.click(screen.getByTestId("rollup-header"));
    fireEvent.click(screen.getAllByTestId("rollup-member")[0] as HTMLElement);

    expect(useUiStore.getState().focusTarget).toMatchObject({ kind: "card", id: branch });
  });

  it("asks for a card when the selection is empty instead of printing a zero", () => {
    const { workspace } = seeded();
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ rollupOpen: true });

    render(<RollupSummaryHost workspace={workspace} />);

    expect(screen.queryByTestId("rollup-summary")).toBeNull();
    expect(screen.getByTestId("rollup-panel")).toHaveTextContent("Select a card");
  });
});
