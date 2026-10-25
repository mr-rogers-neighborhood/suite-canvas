import { WorkspaceDocument as Document } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { BoardTabs } from "./BoardTabs";

const boards = [
  { id: "b1", name: "Research", createdAt: 0, updatedAt: 0, tags: [] },
  { id: "b2", name: "Drafts", createdAt: 1, updatedAt: 1, tags: [] },
  { id: "b3", name: "Archive", createdAt: 2, updatedAt: 2, tags: [] },
];

const baseProps = {
  boards,
  activeBoardId: "b1",
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onRename: vi.fn(),
  onClose: vi.fn(),
};

describe("BoardTabs presence", () => {
  it("should mark each board a peer is reading and name them", () => {
    render(
      <BoardTabs
        {...baseProps}
        peersByBoard={{
          b2: { label: "Ada, Bob", color: "#ff0000" },
          b3: { label: "Cy", color: "#0000ff" },
        }}
      />,
    );

    const dots = screen.getAllByTestId("board-tab-peer-dot");
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveAttribute("aria-label", "Ada, Bob here now");
    expect(dots[0]).toHaveAttribute("title", "Ada, Bob here now");
    expect(dots[1]).toHaveAttribute("aria-label", "Cy here now");

    // The board without company carries no dot.
    expect(
      screen.getByTestId("board-tab-b1").querySelector('[data-testid="board-tab-peer-dot"]'),
    ).toBeNull();
  });

  it("should render no presence dots without peers", () => {
    render(<BoardTabs {...baseProps} />);
    expect(screen.queryAllByTestId("board-tab-peer-dot")).toHaveLength(0);
  });
});

describe("BoardTabs close", () => {
  beforeEach(() => {
    useUiStore.setState({
      activeBoardId: null,
      openBoardIds: [],
      boardHistory: [],
      boardViewports: {},
      viewportRequest: null,
      selectedNodeIds: [],
    });
  });

  /**
   * A tab is a view of a board, not a claim on it: closing one is a state
   * change in the shell and nothing more. The board keeps its cards and stays
   * in the workspace, which is why no question is asked.
   */
  it("should close the tab without writing the document", () => {
    const workspace = new Document();
    workspace.ensureDefaultTypes();
    const first = workspace.ensureBoard();
    const second = workspace.createBoard({ name: "Drafts" });
    const card = workspace.createCard({ boardId: first.id });
    const version = workspace.doc.version().toJSON();
    const allBoards = workspace.listBoards();

    useUiStore.setState({
      activeBoardId: first.id,
      openBoardIds: [first.id, second.id],
    });

    render(
      <BoardTabs
        boards={allBoards}
        activeBoardId={first.id}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onClose={(boardId) => useUiStore.getState().closeBoardTab(boardId)}
      />,
    );

    fireEvent.click(screen.getByLabelText(`Close ${first.name}`));

    // The tab is gone and the next open board takes the screen...
    expect(useUiStore.getState().openBoardIds).toEqual([second.id]);
    expect(useUiStore.getState().activeBoardId).toBe(second.id);
    // ...while the document, the board and its cards are untouched.
    expect(workspace.doc.version().toJSON()).toEqual(version);
    expect(workspace.listBoards().map((board) => board.id)).toEqual(
      allBoards.map((board) => board.id),
    );
    expect(workspace.listBoardCards(first.id).map((entry) => entry.id)).toEqual([card.id]);
    expect(workspace.listCardPlacements(card.id).map((entry) => entry.boardId)).toEqual([first.id]);
  });

  it("should close a background tab without switching boards", () => {
    useUiStore.setState({
      activeBoardId: "b1",
      openBoardIds: ["b1", "b2", "b3"],
    });

    render(<BoardTabs {...baseProps} onClose={useUiStore.getState().closeBoardTab} />);

    fireEvent.click(screen.getByLabelText("Close Drafts"));

    expect(useUiStore.getState().openBoardIds).toEqual(["b1", "b3"]);
    expect(useUiStore.getState().activeBoardId).toBe("b1");
  });
});
