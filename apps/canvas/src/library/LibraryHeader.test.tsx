import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryHeader } from "./LibraryHeader";

const base = {
  counts: { trash: 3 },
  canManageTrash: true,
  onTab: () => {},
  activeViewName: null,
  onExitView: () => {},
  scope: "all" as const,
  onScope: () => {},
  activeBoardId: null,
  activeBoardName: null,
  full: false,
  onFull: () => {},
  selectableCount: 0,
  selecting: false,
  onToggleSelecting: () => {},
  onCreateInInbox: () => {},
  onClose: () => {},
};

function renderHeader(overrides: Partial<Parameters<typeof LibraryHeader>[0]> = {}) {
  const onEmptyTrash = vi.fn();
  render(
    <LibraryHeader
      {...base}
      tab="trash"
      trashCount={3}
      onEmptyTrash={onEmptyTrash}
      {...overrides}
    />,
  );
  return onEmptyTrash;
}

/**
 * Emptying the trash deletes every card in it for good, and it used to be one
 * press with nothing to undo. The press now asks, and the question says how
 * much goes.
 */
describe("emptying the trash", () => {
  it("asks before deleting, and says how many cards go", () => {
    const onEmptyTrash = renderHeader();

    fireEvent.click(screen.getByTestId("library-empty-trash"));

    expect(onEmptyTrash).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialog")).toHaveTextContent("3 cards will be deleted for good");
  });

  it("deletes once the reader confirms", () => {
    const onEmptyTrash = renderHeader();

    fireEvent.click(screen.getByTestId("library-empty-trash"));
    fireEvent.click(
      within(screen.getByTestId("dialog")).getByRole("button", { name: "Empty trash" }),
    );

    expect(onEmptyTrash).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("deletes nothing when the reader cancels", () => {
    const onEmptyTrash = renderHeader();

    fireEvent.click(screen.getByTestId("library-empty-trash"));
    fireEvent.click(within(screen.getByTestId("dialog")).getByRole("button", { name: "Cancel" }));

    expect(onEmptyTrash).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("counts one card as one card", () => {
    renderHeader({ trashCount: 1 });

    fireEvent.click(screen.getByTestId("library-empty-trash"));

    expect(screen.getByTestId("dialog")).toHaveTextContent("1 card will be deleted for good");
  });
});
