import type { Board } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardSwitcher, groupBoards } from "./BoardSwitcher";

function board(id: string, name: string, updatedAt = 0, color?: Board["color"]): Board {
  return { id, name, createdAt: 0, updatedAt, tags: [], ...(color ? { color } : {}) };
}

const boards = [board("b1", "Research", 10), board("b2", "Drafts", 30), board("b3", "Archive", 20)];

const baseProps = {
  boards,
  activeBoardId: "b1",
  recency: ["b1"],
  pinned: [],
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onOpenLibrary: vi.fn(),
  onRename: vi.fn(),
  onSetColor: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("groupBoards", () => {
  it("should put pins in the order they were pinned", () => {
    const groups = groupBoards(boards, [], ["b3", "b1"]);
    expect(groups.pinned.map((entry) => entry.id)).toEqual(["b3", "b1"]);
    expect(groups.recent.map((entry) => entry.id)).toEqual(["b2"]);
  });

  it("should order the rest by this session's recency, then by when they changed", () => {
    const groups = groupBoards(boards, ["b3"], []);
    // Drafts changed most recently but the session was last on Archive.
    expect(groups.recent.map((entry) => entry.id)).toEqual(["b3", "b2", "b1"]);
  });

  it("should ignore a pin whose board is gone", () => {
    expect(groupBoards(boards, [], ["deleted"]).pinned).toEqual([]);
  });
});

describe("BoardSwitcher", () => {
  it("should name the board on screen without taking the row", () => {
    render(<BoardSwitcher {...baseProps} />);
    const trigger = screen.getByTestId("board-switcher");
    expect(trigger).toHaveTextContent("Research");
    // The name truncates; the control itself is capped.
    expect(trigger.className).toContain("max-w-[220px]");
  });

  it("should mark the current board and switch to another", () => {
    const onSelect = vi.fn();
    render(<BoardSwitcher {...baseProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId("board-switcher"));
    expect(screen.getByTestId("board-switch-b1")).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByTestId("board-switch-b3"));
    expect(onSelect).toHaveBeenCalledWith("b3");
    // Choosing a board closes the list.
    expect(screen.queryByTestId("board-switcher-menu")).toBeNull();
  });

  it("should group pinned boards above the rest", () => {
    render(<BoardSwitcher {...baseProps} pinned={["b3"]} />);
    fireEvent.click(screen.getByTestId("board-switcher"));

    const labels = screen.getAllByText(/^(Pinned|Recent)$/).map((element) => element.textContent);
    expect(labels).toEqual(["Pinned", "Recent"]);
  });

  it("should offer a new board and the library", () => {
    const onCreate = vi.fn();
    const onOpenLibrary = vi.fn();
    render(<BoardSwitcher {...baseProps} onCreate={onCreate} onOpenLibrary={onOpenLibrary} />);

    fireEvent.click(screen.getByTestId("board-switcher"));
    fireEvent.click(screen.getByTestId("board-switcher-new"));
    expect(onCreate).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("board-switcher"));
    fireEvent.click(screen.getByTestId("board-switcher-all"));
    expect(onOpenLibrary).toHaveBeenCalled();
  });

  it("should pin from a row's own menu", () => {
    const onTogglePin = vi.fn();
    render(<BoardSwitcher {...baseProps} onTogglePin={onTogglePin} />);

    fireEvent.click(screen.getByTestId("board-switcher"));
    fireEvent.contextMenu(screen.getByTestId("board-switch-b2"));
    fireEvent.click(screen.getByTestId("board-row-menu-pin"));
    expect(onTogglePin).toHaveBeenCalledWith("b2");
  });

  it("should colour a board from a row's own menu", () => {
    const onSetColor = vi.fn();
    render(<BoardSwitcher {...baseProps} onSetColor={onSetColor} />);

    fireEvent.click(screen.getByTestId("board-switcher"));
    fireEvent.contextMenu(screen.getByTestId("board-switch-b2"));
    fireEvent.click(screen.getByTestId("board-row-color-blue"));
    expect(onSetColor).toHaveBeenCalledWith("b2", "blue");
  });

  it("should rename a board in place from its menu", () => {
    const onRename = vi.fn();
    render(<BoardSwitcher {...baseProps} onRename={onRename} />);

    fireEvent.click(screen.getByTestId("board-switcher"));
    fireEvent.contextMenu(screen.getByTestId("board-switch-b2"));
    fireEvent.click(screen.getByTestId("board-row-menu-rename"));

    const input = screen.getByTestId("board-switch-rename-b2");
    fireEvent.change(input, { target: { value: "Second draft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("b2", "Second draft");
  });

  it("should not rename a board a viewer cannot manage", () => {
    render(<BoardSwitcher {...baseProps} canManage={false} />);
    fireEvent.click(screen.getByTestId("board-switcher"));
    fireEvent.contextMenu(screen.getByTestId("board-switch-b2"));
    expect(screen.getByTestId("board-row-menu-rename")).toBeDisabled();
    expect(screen.getByTestId("board-row-color-blue")).toBeDisabled();
  });

  it("should mark boards someone else is reading", () => {
    render(
      <BoardSwitcher {...baseProps} peersByBoard={{ b2: { label: "Ada", color: "#ff0000" } }} />,
    );
    fireEvent.click(screen.getByTestId("board-switcher"));
    expect(screen.getByTestId("board-switch-peer-b2")).toHaveAttribute(
      "aria-label",
      "Ada here now",
    );
    expect(screen.queryByTestId("board-switch-peer-b1")).toBeNull();
  });

  it("should keep the control usable in an empty workspace", () => {
    render(<BoardSwitcher {...baseProps} boards={[]} activeBoardId={null} />);
    fireEvent.click(screen.getByTestId("board-switcher"));
    expect(screen.getByText("This workspace has no boards yet.")).toBeInTheDocument();
    expect(screen.getByTestId("board-switcher-new")).toBeInTheDocument();
  });
});
