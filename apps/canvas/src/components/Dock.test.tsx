import type { CardType } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dock } from "./Dock";

const types: CardType[] = [
  { id: "note", name: "Note", glyph: "\u25a1", createdAt: 0, updatedAt: 0, fields: [] },
  { id: "project", name: "Project", glyph: "P", createdAt: 0, updatedAt: 0, fields: [] },
];

function mount(overrides: Partial<Parameters<typeof Dock>[0]> = {}) {
  return render(
    <Dock
      inboxCount={0}
      libraryOpen={false}
      types={types}
      onToggleLibrary={() => {}}
      onCreateCard={() => {}}
      onCreateBoard={() => {}}
      onManageTypes={() => {}}
      {...overrides}
    />,
  );
}

describe("Dock board creation", () => {
  it("should list every card type", () => {
    mount();
    fireEvent.click(screen.getByTestId("dock-new-card"));

    expect(screen.getByTestId("dock-type-note")).toBeInTheDocument();
    expect(screen.getByTestId("dock-type-project")).toBeInTheDocument();
  });

  it("should plant a board from one action", () => {
    const onCreateBoard = vi.fn();
    mount({ onCreateBoard });

    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-board"));

    expect(onCreateBoard).toHaveBeenCalledTimes(1);
  });

  it("should close the menu after planting a board", () => {
    mount();

    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-board"));

    expect(screen.queryByTestId("dock-type-menu")).toBeNull();
  });

  it("should offer a new board only when the session may create one", () => {
    const first = mount({ canCreateBoards: true });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    expect(screen.getByTestId("dock-new-board")).toBeInTheDocument();
    first.unmount();

    mount({ canCreateBoards: false });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    expect(screen.queryByTestId("dock-new-board")).toBeNull();
  });

  it("should not offer a new board to a session that cannot create content", () => {
    mount({ canCreateContent: false });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    expect(screen.queryByTestId("dock-new-board")).toBeNull();
  });
});
