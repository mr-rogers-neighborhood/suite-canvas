import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RollupSummary } from "./RollupSummary";
import type { Rollup } from "./rollup";

const rollup: Rollup = {
  cardId: "summary",
  title: "Reading list",
  members: [
    { cardId: "a", title: "Alpha", kind: "claim", boardId: "board-1", onBoard: true },
    { cardId: "b", title: "Beta", kind: "note", boardId: "board-2", onBoard: false },
    { cardId: "c", title: "Gamma", kind: "note", boardId: "board-1", onBoard: true },
  ],
  count: 3,
  elsewhere: 1,
};

const empty: Rollup = { cardId: "empty", title: "Empty", members: [], count: 0, elsewhere: 0 };

describe("RollupSummary", () => {
  it("should print the count its list holds", () => {
    render(<RollupSummary rollup={rollup} defaultExpanded />);
    expect(screen.getByTestId("rollup-count")).toHaveTextContent("3 cards · 1 elsewhere");
    expect(screen.getAllByTestId("rollup-member")).toHaveLength(3);
  });

  it("should stay collapsed until asked, and then list every member", () => {
    render(<RollupSummary rollup={rollup} />);
    expect(screen.queryByTestId("rollup-members")).toBeNull();

    fireEvent.click(screen.getByTestId("rollup-header"));

    const rows = screen.getAllByTestId("rollup-member");
    expect(rows).toHaveLength(rollup.count);
  });

  it("should mark a member that sits on another board", () => {
    render(<RollupSummary rollup={rollup} defaultExpanded />);
    const beta = screen.getAllByTestId("rollup-member")[1];
    if (!beta) throw new Error("expected a second member row");
    expect(within(beta).getByTestId("rollup-member-elsewhere")).toBeInTheDocument();
    expect(screen.getAllByTestId("rollup-member-elsewhere")).toHaveLength(rollup.elsewhere);
  });

  it("should open the member it names", () => {
    const onOpen = vi.fn();
    render(<RollupSummary rollup={rollup} defaultExpanded onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Gamma"));
    expect(onOpen).toHaveBeenCalledWith("c");
  });

  it("should offer no disclosure for a card that hides nothing", () => {
    render(<RollupSummary rollup={empty} />);
    expect(screen.getByTestId("rollup-count")).toHaveTextContent("Nothing to summarise");
    expect(screen.getByTestId("rollup-header")).toBeDisabled();
  });

  it("should keep every member reachable from the keyboard", () => {
    render(<RollupSummary rollup={rollup} defaultExpanded />);
    for (const row of screen.getAllByTestId("rollup-member")) {
      expect(row.tagName).toBe("BUTTON");
      expect(row).not.toHaveAttribute("tabindex", "-1");
    }
  });
});
