import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypeTableRow } from "../ice/useTypeTable";
import { useUiStore } from "../store/useUiStore";
import { TypeTable } from "./TypeTable";

const rows: TypeTableRow[] = [
  { typeId: "note", name: "Note", glyph: "\u25a1", count: 6, share: 0.6 },
  { typeId: "concept", name: "Concept", glyph: "\u25c6", count: 3, share: 0.3, color: "#8b5cf6" },
  { typeId: "project", name: "Project", glyph: "P", count: 1, share: 0.1 },
];

function resetUi(): void {
  useUiStore.setState({
    readOnly: false,
    libraryOpen: false,
    libraryTab: "inbox",
    libraryTypeFilter: [],
    libraryTagFilter: [],
    librarySectionFilter: [],
    libraryScope: "all",
  });
}

beforeEach(resetUi);

function mount(overrides: Partial<Parameters<typeof TypeTable>[0]> = {}) {
  return render(<TypeTable rows={rows} boardId="board-1" onFrameType={() => {}} {...overrides} />);
}

describe("TypeTable", () => {
  it("should render one row per type with its glyph, name and count", () => {
    mount();

    expect(screen.getByTestId("type-table")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("type-table-row-note")).toHaveTextContent("Note");
    expect(screen.getByTestId("type-table-row-note")).toHaveTextContent("\u25a1");
    expect(screen.getByTestId("type-table-count-note")).toHaveTextContent("6");
    expect(screen.getByTestId("type-table-count-project")).toHaveTextContent("1");
  });

  it("should draw the share bar at the row's share", () => {
    mount();

    const bar = screen.getByTestId("type-table-share-note");
    expect(bar).toHaveAttribute("data-share", "0.6");
    expect(bar.firstElementChild).toHaveStyle({ width: "60%" });
  });

  it("should show an empty state instead of rows", () => {
    mount({ rows: [] });

    expect(screen.getByTestId("type-table-empty")).toHaveTextContent("No cards");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("should scope the library to the type and the board and frame the type", () => {
    useUiStore.setState({
      libraryTab: "cards",
      libraryTagFilter: ["tag-1"],
      librarySectionFilter: ["section-1"],
      libraryQuery: "grading",
    });
    const onFrameType = vi.fn();
    mount({ onFrameType });

    fireEvent.click(screen.getByTestId("type-table-row-note"));

    const state = useUiStore.getState();
    expect(state.libraryTypeFilter).toEqual(["note"]);
    // A scoped library is exactly this type on this board, not this type plus
    // whatever facets were left over.
    expect(state.libraryTagFilter).toEqual([]);
    expect(state.librarySectionFilter).toEqual([]);
    expect(state.libraryScope).toBe("board");
    expect(state.libraryOpen).toBe(true);
    // The drawer stays on the tab the user was reading.
    expect(state.libraryTab).toBe("cards");
    expect(onFrameType).toHaveBeenCalledWith("note");
    expect(screen.getByTestId("type-table-row-note")).toHaveAttribute("aria-pressed", "true");
  });

  it("should leave the scope at all when there is no board", () => {
    mount({ boardId: null });

    fireEvent.click(screen.getByTestId("type-table-row-concept"));

    expect(useUiStore.getState().libraryScope).toBe("all");
    expect(useUiStore.getState().libraryTypeFilter).toEqual(["concept"]);
  });

  it("should offer select-all to a session that cannot create, and disable the writes", () => {
    const onSelectAll = vi.fn();
    const onPlaceOnView = vi.fn();
    const onDuplicate = vi.fn();
    mount({ onSelectAll, onPlaceOnView, onDuplicate, canEditContent: false, canEditLayout: true });

    fireEvent.click(screen.getByTestId("type-table-actions-note"));

    expect(screen.getByTestId("type-table-select-note")).toBeEnabled();
    expect(screen.getByTestId("type-table-place-note")).toBeDisabled();
    expect(screen.getByTestId("type-table-duplicate-note")).toBeDisabled();

    fireEvent.click(screen.getByTestId("type-table-select-note"));
    expect(onSelectAll).toHaveBeenCalledWith("note");
    expect(onPlaceOnView).not.toHaveBeenCalled();
    expect(screen.queryByTestId("type-table-menu-note")).toBeNull();
  });

  it("should offer the write actions to a session that may create content", () => {
    const onPlaceOnView = vi.fn();
    const onDuplicate = vi.fn();
    mount({ onPlaceOnView, onDuplicate, canEditContent: true, canEditLayout: true });

    fireEvent.click(screen.getByTestId("type-table-actions-project"));
    expect(screen.getByTestId("type-table-place-project")).toBeEnabled();
    fireEvent.click(screen.getByTestId("type-table-duplicate-project"));

    expect(onDuplicate).toHaveBeenCalledWith("project");
    expect(onPlaceOnView).not.toHaveBeenCalled();
  });

  it("should give a viewer the rows and no action buttons", () => {
    mount({
      readOnly: true,
      onSelectAll: vi.fn(),
      onPlaceOnView: vi.fn(),
      onDuplicate: vi.fn(),
    });

    expect(screen.getAllByTestId(/^type-table-row-/)).toHaveLength(3);
    expect(screen.queryByTestId("type-table-actions-note")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("should omit the actions trigger when the host wires no actions", () => {
    mount();

    expect(screen.queryByTestId("type-table-actions-note")).toBeNull();
  });
});
