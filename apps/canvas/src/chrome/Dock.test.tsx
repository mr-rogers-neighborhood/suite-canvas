import type { CardType } from "@suite/graph";
import { PORTAL_TYPE_ID } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dock } from "./Dock";

const types: CardType[] = [
  { id: "note", name: "Note", glyph: "\u25a1", createdAt: 0, updatedAt: 0, fields: [] },
  { id: "project", name: "Project", glyph: "P", createdAt: 0, updatedAt: 0, fields: [] },
  {
    id: PORTAL_TYPE_ID,
    name: "Portal",
    glyph: "\u25c9",
    createdAt: 0,
    updatedAt: 0,
    fields: [],
  },
];

const boards = [
  { id: "b1", name: "Research", createdAt: 0, updatedAt: 0, tags: [] },
  { id: "b2", name: "Drafts", createdAt: 1, updatedAt: 1, tags: [] },
];

function mount(overrides: Partial<Parameters<typeof Dock>[0]> = {}) {
  return render(
    <Dock
      inboxCount={0}
      libraryOpen={false}
      types={types}
      boards={boards}
      activeBoardId="b1"
      onToggleLibrary={() => {}}
      onCreateCard={() => {}}
      onCreatePortal={() => {}}
      onCreateBoardPortal={() => {}}
      onManageTypes={() => {}}
      {...overrides}
    />,
  );
}

describe("Dock portal creation", () => {
  it("should keep the portal type out of the ordinary new-card list", () => {
    mount();
    fireEvent.click(screen.getByTestId("dock-new-card"));

    expect(screen.getByTestId("dock-type-note")).toBeInTheDocument();
    expect(screen.queryByTestId(`dock-type-${PORTAL_TYPE_ID}`)).toBeNull();
    expect(screen.getByTestId("dock-new-portal")).toBeInTheDocument();
  });

  it("should list the other boards as portal targets", () => {
    const onCreatePortal = vi.fn();
    mount({ onCreatePortal });

    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-portal"));

    expect(screen.getByTestId("dock-portal-b2")).toHaveTextContent("Drafts");
    // The current board cannot portal to itself.
    expect(screen.queryByTestId("dock-portal-b1")).toBeNull();

    fireEvent.click(screen.getByTestId("dock-portal-b2"));
    expect(onCreatePortal).toHaveBeenCalledWith("b2");
  });

  it("should offer a new board only when the session may create one", () => {
    const first = mount({ canCreateBoards: true });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-portal"));
    expect(screen.getByTestId("dock-portal-new-board")).toBeInTheDocument();
    first.unmount();

    mount({ canCreateBoards: false });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-portal"));
    expect(screen.queryByTestId("dock-portal-new-board")).toBeNull();
  });

  it("should create a board and a portal from one action", () => {
    const onCreateBoardPortal = vi.fn();
    mount({ onCreateBoardPortal });

    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-portal"));
    fireEvent.click(screen.getByTestId("dock-portal-new-board"));

    expect(onCreateBoardPortal).toHaveBeenCalledTimes(1);
  });

  it("should not offer a portal path to a session that cannot create content", () => {
    mount({ canCreateContent: false });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    expect(screen.queryByTestId("dock-new-portal")).toBeNull();
  });

  it("should hide the portal action when no target exists and none can be made", () => {
    mount({ boards: [boards[0] as (typeof boards)[number]], canCreateBoards: false });
    fireEvent.click(screen.getByTestId("dock-new-card"));
    expect(screen.queryByTestId("dock-new-portal")).toBeNull();
  });
});

describe("Dock mirrors the canvas's new-thing menu", () => {
  it("offers Sketch and Section next to the card types", () => {
    const onCreateSketch = vi.fn();
    const onCreateSection = vi.fn();
    mount({ onCreateSketch, onCreateSection });
    fireEvent.click(screen.getByTestId("dock-new-card"));

    fireEvent.click(screen.getByTestId("dock-new-sketch"));
    fireEvent.click(screen.getByTestId("dock-new-card"));
    fireEvent.click(screen.getByTestId("dock-new-section"));

    // The dock is a complete "new" surface, not a subset of the canvas menu.
    expect(onCreateSketch).toHaveBeenCalledTimes(1);
    expect(onCreateSection).toHaveBeenCalledTimes(1);
  });

  it("hides both rows when the caller offers neither", () => {
    mount();
    fireEvent.click(screen.getByTestId("dock-new-card"));
    expect(screen.queryByTestId("dock-new-sketch")).toBeNull();
    expect(screen.queryByTestId("dock-new-section")).toBeNull();
  });
});
