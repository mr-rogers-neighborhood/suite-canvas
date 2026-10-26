import type { Section } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutlineTree } from "./BoardOutline";

/**
 * The outline rail is the only place a board's structure is listed on its own,
 * so an empty board has to say it is empty instead of rendering nothing at all.
 * A rail that disappears is indistinguishable from one that failed to load.
 */

const noop = () => {};

function renderTree(over: { sections?: Section[]; open?: boolean; canCreate?: boolean } = {}) {
  return render(
    <OutlineTree
      sections={over.sections ?? []}
      membership={new Map()}
      peers={[]}
      selectedSectionId={null}
      open={over.open ?? true}
      onToggle={noop}
      onSelect={noop}
      onContextMenu={noop}
      canCreate={over.canCreate ?? false}
    />,
  );
}

describe("an empty outline", () => {
  it("says the board has no sections and names the shortcut that makes one", () => {
    renderTree({ canCreate: true });

    expect(screen.getByTestId("outline-empty")).toHaveTextContent("No sections on this board.");
    expect(screen.getByTestId("outline-empty")).toHaveTextContent("Cmd/Ctrl+G makes one.");
    expect(screen.getByTestId("outline-count")).toHaveTextContent("0");
  });

  it("does not offer a shortcut the session cannot use", () => {
    renderTree({ canCreate: false });

    expect(screen.getByTestId("outline-empty")).toHaveTextContent("Sections appear here.");
    expect(screen.getByTestId("outline-empty")).not.toHaveTextContent("G makes one");
  });

  it("keeps the collapsed tab so the rail can be reopened", () => {
    renderTree({ open: false });

    const tab = screen.getByTestId("outline-tab");
    expect(tab).toHaveAccessibleName("Outline, 0 sections");
  });
});

describe("an outline with sections", () => {
  const section: Section = {
    id: "act-one",
    boardId: "board-1",
    title: "Act one",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z: 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it("lists the section instead of the empty state, and selects it", () => {
    const onSelect = vi.fn();
    render(
      <OutlineTree
        sections={[section]}
        membership={new Map()}
        peers={[]}
        selectedSectionId={null}
        open
        onToggle={noop}
        onSelect={onSelect}
        onContextMenu={noop}
      />,
    );

    expect(screen.queryByTestId("outline-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("outline-row"));
    expect(onSelect).toHaveBeenCalledWith("act-one");
  });
});
