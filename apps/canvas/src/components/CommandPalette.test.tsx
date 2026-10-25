import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { buildPaletteItems, type PaletteInput } from "./paletteProviders";
import { type PaletteItem, paletteGroups, rankPaletteItems } from "./paletteRank";

function item(patch: Partial<PaletteItem> & { id: string; title: string }): PaletteItem {
  return { group: "Test", run: () => {}, ...patch };
}

describe("rankPaletteItems", () => {
  const items = [
    item({ id: "a", title: "New note", keywords: ["create", "card"], weight: 50 }),
    item({ id: "b", title: "Amber Terrace", group: "Boards", keywords: ["board"], weight: 10 }),
    item({ id: "c", title: "Toggle the theme", keywords: ["dark", "light"], weight: 70 }),
    item({ id: "d", title: "Search every card", keywords: ["find", "library"], weight: 5 }),
  ];

  it("should list the lowest weight first when the query is empty", () => {
    expect(rankPaletteItems(items, "   ").map((entry) => entry.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("should match a title and a keyword", () => {
    expect(rankPaletteItems(items, "amber").map((entry) => entry.id)).toEqual(["b"]);
    expect(rankPaletteItems(items, "dark").map((entry) => entry.id)).toEqual(["c"]);
  });

  it("should return nothing for a query that matches nothing", () => {
    expect(rankPaletteItems(items, "zzzz")).toEqual([]);
  });

  it("should break ties by weight", () => {
    const same = [
      item({ id: "late", title: "Board", weight: 40 }),
      item({ id: "early", title: "Board", weight: 10 }),
    ];
    expect(rankPaletteItems(same, "board").map((entry) => entry.id)).toEqual(["early", "late"]);
  });
});

describe("paletteGroups", () => {
  it("should bucket in first-seen order and keep the ranked order inside a group", () => {
    const groups = paletteGroups([
      item({ id: "a", title: "One", group: "Actions" }),
      item({ id: "b", title: "Two", group: "Boards" }),
      item({ id: "c", title: "Three", group: "Actions" }),
    ]);
    expect(groups.map((entry) => entry.group)).toEqual(["Actions", "Boards"]);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(["a", "c"]);
  });
});

function paletteInput(patch: Partial<PaletteInput> = {}): PaletteInput {
  const actions = {
    goToBoard: vi.fn(),
    goToSection: vi.fn(),
    focusCard: vi.fn(),
    createCard: vi.fn(),
    createBoard: vi.fn(),
    openLibrary: vi.fn(),
    openTypes: vi.fn(),
    openShare: vi.fn(),
    toggleTheme: vi.fn(),
    openLibrarySearch: vi.fn(),
  };
  return {
    boards: [
      { id: "board-1", name: "Board 1", createdAt: 0, updatedAt: 0, sort: 0 } as never,
      { id: "board-2", name: "Research", createdAt: 0, updatedAt: 0, sort: 1 } as never,
    ],
    cards: [
      { id: "c1", typeIds: ["note"], primaryTypeId: "note", tags: [], properties: {} } as never,
    ],
    types: [
      { id: "note", name: "Note", glyph: "□", fields: [] } as never,
      { id: "whiteboard", name: "Whiteboard", glyph: "▧", fields: [] } as never,
    ],
    sections: [{ id: "s1", boardId: "board-1", title: "Act one" } as never],
    views: [{ id: "v1", name: "Drafts", position: 0 } as never],
    activeBoardId: "board-1",
    titleOf: () => "Alpha",
    typeNameOf: () => "Note",
    canCreateContent: true,
    canCreateBoards: true,
    canManageSchema: true,
    actions,
    ...patch,
  };
}

describe("buildPaletteItems", () => {
  it("should offer boards, views, sections, cards and actions", () => {
    const items = buildPaletteItems(paletteInput());
    const titles = items.map((entry) => entry.title);
    expect(titles).toContain("Research");
    expect(titles).toContain("Drafts");
    expect(titles).toContain("Act one");
    expect(titles).toContain("Alpha");
    expect(titles).toContain("Search every card");
    expect(items.some((entry) => entry.group === "Create")).toBe(true);
  });

  it("should skip the current board when it is the only one", () => {
    const items = buildPaletteItems(
      paletteInput({ boards: [{ id: "board-1", name: "Solo" } as never] }),
    );
    expect(items.some((entry) => entry.group === "Boards")).toBe(false);
  });

  it("should hide creation entries a read-only session cannot run", () => {
    const items = buildPaletteItems(
      paletteInput({ canCreateContent: false, canCreateBoards: false, canManageSchema: false }),
    );
    expect(items.some((entry) => entry.id === "action:new-board")).toBe(false);
    expect(items.some((entry) => entry.id.startsWith("action:new:"))).toBe(false);
    expect(items.some((entry) => entry.id === "action:types")).toBe(false);
    // Reading and sharing stay available.
    expect(items.some((entry) => entry.id === "action:share")).toBe(true);
  });

  it("should route each row to the matching action", () => {
    const input = paletteInput();
    const items = buildPaletteItems(input);
    const run = (id: string) => items.find((entry) => entry.id === id)?.run();

    run("board:board-2");
    expect(input.actions.goToBoard).toHaveBeenCalledWith("board-2");

    run("section:s1");
    expect(input.actions.goToSection).toHaveBeenCalledWith("s1");

    run("card:c1");
    expect(input.actions.focusCard).toHaveBeenCalledWith("c1");

    run("action:new:note");
    expect(input.actions.createCard).toHaveBeenCalledWith("note");

    run("action:new-board");
    expect(input.actions.createBoard).toHaveBeenCalledOnce();
  });
});

describe("CommandPalette", () => {
  const items = [
    item({ id: "board:b2", title: "Research", subtitle: "Board", group: "Boards", weight: 10 }),
    item({ id: "action:theme", title: "Toggle the theme", group: "Actions", weight: 70 }),
  ];

  it("should list rows grouped and run the highlighted one on Enter", () => {
    const onClose = vi.fn();
    const run = vi.fn();
    const rows: PaletteItem[] = [{ ...(items[0] as PaletteItem), run }, items[1] as PaletteItem];
    render(<CommandPalette items={rows} onClose={onClose} />);

    const list = screen.getByTestId("command-palette-results");
    expect(within(list).getByText("Research")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "Enter" });

    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should filter as the query changes and show an empty state", () => {
    render(<CommandPalette items={items} onClose={() => {}} />);
    const input = screen.getByTestId("command-palette-input");

    fireEvent.change(input, { target: { value: "theme" } });
    expect(screen.getAllByTestId("command-palette-row")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });

  it("should move the highlight with the arrow keys and wrap", () => {
    render(<CommandPalette items={items} onClose={() => {}} />);
    const palette = screen.getByTestId("command-palette");
    const rows = () => screen.getAllByTestId("command-palette-row");

    expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(palette, { key: "ArrowDown" });
    expect(rows()[1]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(palette, { key: "ArrowDown" });
    expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(palette, { key: "ArrowUp" });
    expect(rows()[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("should close on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
