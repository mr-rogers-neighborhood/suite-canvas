import type { Board } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BoardVisit, ViewportState } from "../store/useUiStore";
import { BoardTrail } from "./BoardTrail";

const viewport: ViewportState = { x: 0, y: 0, zoom: 1 };

const board = (id: string, name: string): Board => ({
  id,
  name,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

const boards = [
  board("home", "Home"),
  board("guide", "Guide"),
  board("notes", "Notes"),
  board("deep", "Deep"),
  board("leaf", "Leaf"),
];

const visit = (boardId: string, via: BoardVisit["via"]): BoardVisit => ({
  boardId,
  viewport,
  via,
});

describe("BoardTrail", () => {
  it("should draw nothing when nothing was left behind", () => {
    render(<BoardTrail boards={boards} activeBoardId="home" onSelect={vi.fn()} history={[]} />);
    expect(screen.queryByTestId("board-trail")).toBeNull();
  });

  it("should show the boards the reader came from and the one on screen", () => {
    const onSelect = vi.fn();
    render(
      <BoardTrail
        boards={boards}
        activeBoardId="notes"
        onSelect={onSelect}
        history={[visit("home", "manual"), visit("guide", "portal")]}
      />,
    );

    expect(screen.getByTestId("board-trail")).toBeInTheDocument();
    const steps = screen.getAllByTestId(/^board-trail-step-/);
    expect(steps.map((step) => step.textContent)).toEqual(["Home", "Guide", "Notes"]);
    // The board on screen is a label, not a place to go.
    expect(screen.getByTestId("board-trail-step-notes")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Back to Notes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(onSelect).toHaveBeenCalledWith("home");
  });

  it("should say how each board was entered, so a tab stop is not read as a parent", () => {
    render(
      <BoardTrail
        boards={boards}
        activeBoardId="notes"
        onSelect={vi.fn()}
        history={[visit("home", "manual"), visit("guide", "portal")]}
      />,
    );

    // The `via` of a visit names the arrival at the board after it.
    expect(screen.getByTestId("board-trail-step-guide")).toHaveAttribute("data-via", "manual");
    expect(screen.getByTestId("board-trail-step-guide")).toHaveAttribute(
      "title",
      "Back to Guide \u00b7 opened from a tab or the library",
    );
    expect(screen.getByTestId("board-trail-step-notes")).toHaveAttribute("data-via", "portal");
    expect(screen.getByTestId("board-trail-step-notes")).toHaveAttribute(
      "title",
      "Entered through a portal",
    );
  });

  it("should fold everything past three steps into one ellipsis", () => {
    const path = Array.from({ length: 6 }, (_, index) => board(`b${index}`, `Step ${index}`));
    render(
      <BoardTrail
        boards={path}
        activeBoardId="b5"
        onSelect={vi.fn()}
        history={[
          visit("b0", "manual"),
          visit("b1", "manual"),
          visit("b2", "portal"),
          visit("b3", "portal"),
          visit("b4", "portal"),
        ]}
      />,
    );

    // The oldest step, the two nearest ones, and the board on screen.
    const steps = screen.getAllByTestId(/^board-trail-step-/);
    expect(steps.map((step) => step.textContent)).toEqual(["Step 0", "Step 3", "Step 4", "Step 5"]);
    expect(screen.getByTestId("board-trail-fold")).toHaveAttribute("title", "2 earlier boards");
    // A folded step is not a step: the trail offers the boards it still shows.
    expect(screen.queryByRole("button", { name: "Back to Step 2" })).toBeNull();
  });

  it("should keep the current board as the last step when its name is unknown to the trail", () => {
    render(
      <BoardTrail
        boards={[board("home", "Home")]}
        activeBoardId="gone"
        onSelect={vi.fn()}
        history={[visit("home", "manual")]}
      />,
    );
    // Nothing to name the board on screen, so the trail stays out of the way.
    expect(screen.queryByTestId("board-trail")).toBeNull();
  });

  it("should skip a step whose board no longer exists", () => {
    const onSelect = vi.fn();
    render(
      <BoardTrail
        boards={[board("home", "Home"), board("notes", "Notes")]}
        activeBoardId="notes"
        onSelect={onSelect}
        history={[visit("deleted", "manual"), visit("home", "manual")]}
      />,
    );

    expect(screen.queryByTestId("board-trail-step-deleted")).toBeNull();
    // The surviving step is still reachable, and the arrival it names is the one
    // recorded against the visit that was skipped.
    expect(screen.getByTestId("board-trail-step-home")).toHaveAttribute("data-via", "manual");
    fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(onSelect).toHaveBeenCalledWith("home");
  });

  it("should offer every step as a button, so the trail is walkable from the keyboard", () => {
    render(
      <BoardTrail
        boards={boards}
        activeBoardId="notes"
        onSelect={vi.fn()}
        history={[visit("home", "manual"), visit("guide", "manual")]}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Home", "Guide"]);
    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "button");
      expect(button.tabIndex).toBe(0);
    }
  });
});
