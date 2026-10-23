import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardTabs } from "./BoardTabs";

const boards = [
  { id: "b1", name: "Research", createdAt: 0, updatedAt: 0 },
  { id: "b2", name: "Drafts", createdAt: 1, updatedAt: 1 },
  { id: "b3", name: "Archive", createdAt: 2, updatedAt: 2 },
];

const baseProps = {
  boards,
  activeBoardId: "b1",
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onRename: vi.fn(),
  onDeleteRequest: vi.fn(),
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
