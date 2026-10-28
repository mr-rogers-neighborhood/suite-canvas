import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StartPage } from "./StartPage";

const boards = [
  { id: "b1", name: "Research", createdAt: 0, updatedAt: 30, tags: [] },
  { id: "b2", name: "Drafts", createdAt: 1, updatedAt: 20, tags: [] },
  { id: "b3", name: "Archive", createdAt: 2, updatedAt: 10, tags: [] },
];

describe("StartPage", () => {
  it("should list the most recently touched boards first", () => {
    render(<StartPage boards={boards} onOpen={vi.fn()} onCreate={vi.fn()} />);

    const rows = screen.getAllByTestId(/^start-page-board-/);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Research"),
      expect.stringContaining("Drafts"),
      expect.stringContaining("Archive"),
    ]);
  });

  it("should open the board a reader clicks", () => {
    const onOpen = vi.fn();
    render(<StartPage boards={boards} cardCounts={{ b2: 4 }} onOpen={onOpen} onCreate={vi.fn()} />);

    expect(screen.getByTestId("start-page-board-b2")).toHaveTextContent("4 cards");
    fireEvent.click(screen.getByTestId("start-page-board-b2"));
    expect(onOpen).toHaveBeenCalledWith("b2");
  });

  it("should narrow the list to the search and open the first match on Enter", () => {
    const onOpen = vi.fn();
    render(<StartPage boards={boards} onOpen={onOpen} onCreate={vi.fn()} />);

    fireEvent.change(screen.getByTestId("start-page-search"), { target: { value: "draf" } });
    expect(screen.getAllByTestId(/^start-page-board-/)).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId("start-page-search"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("b2");
  });

  it("should say so when no board matches", () => {
    render(<StartPage boards={boards} onOpen={vi.fn()} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByTestId("start-page-search"), { target: { value: "zzz" } });
    expect(screen.getByText("No board by that name.")).toBeInTheDocument();
  });

  it("should not offer to create a board a viewer may not create", () => {
    render(<StartPage boards={boards} canCreate={false} onOpen={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.queryByTestId("start-page-new")).toBeNull();
  });
});
