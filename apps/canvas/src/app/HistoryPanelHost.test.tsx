import { WorkspaceDocument } from "@suite/graph";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { HistoryPanelHost } from "./HistoryPanelHost";

/**
 * The history panel in the shell.
 *
 * Two things have to hold: the panel is reachable from a control on the board,
 * and a document change reaches the list while it is open — a list that only
 * re-reads when it is re-opened would show a restore target that is already
 * behind the document.
 */

function seeded(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText("c1", "First note");
  return workspace;
}

function points(): HTMLElement[] {
  return within(screen.getByTestId("history-points")).getAllByRole("button");
}

beforeEach(() => {
  useCanvasStore.setState({ workspace: new WorkspaceDocument() });
});

describe("HistoryPanelHost", () => {
  it("stays closed until its toggle is pressed, and closes again", () => {
    const workspace = seeded();
    useCanvasStore.setState({ workspace });
    render(<HistoryPanelHost workspace={workspace} />);

    expect(screen.queryByTestId("history-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("history-toggle"));
    expect(screen.getByTestId("history-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("history-close"));
    expect(screen.queryByTestId("history-panel")).toBeNull();
  });

  it("re-reads the saved points after the document changes", async () => {
    const workspace = seeded();
    useCanvasStore.setState({ workspace });
    render(<HistoryPanelHost workspace={workspace} />);
    fireEvent.click(screen.getByTestId("history-toggle"));

    const before = points().length;
    act(() => {
      const board = workspace.listBoards()[0];
      if (!board) throw new Error("no board");
      const card = workspace.createCard({ boardId: board.id, position: { x: 420, y: 0 } });
      workspace.setTitleText(card.id, "Second note");
    });

    await waitFor(() => expect(points().length).toBeGreaterThan(before));
  });
});
