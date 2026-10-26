import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import {
  allCapabilities,
  type Capability,
  type CommandActions,
  type CommandContext,
  type CommandState,
  commands,
} from "./commandRegistry";
import { buildPaletteItems } from "./paletteProviders";
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

function actions(): CommandActions {
  return {
    openPalette: vi.fn(),
    openLibrary: vi.fn(),
    openLibraryTab: vi.fn(),
    searchLibrary: vi.fn(),
    goToBoard: vi.fn(),
    goToSection: vi.fn(),
    focusCard: vi.fn(),
    openCard: vi.fn(),
    applyView: vi.fn(),
    exitView: vi.fn(),
    createCard: vi.fn(),
    createCardInInbox: vi.fn(),
    createSketch: vi.fn(),
    createSection: vi.fn(),
    createBoard: vi.fn(),
    editCard: vi.fn(),
    setCardType: vi.fn(),
    trashCard: vi.fn(),
    restoreCard: vi.fn(),
    deleteCardForever: vi.fn(),
    emptyTrash: vi.fn(),
    duplicateCard: vi.fn(),
    removeFromBoard: vi.fn(),
    placeCard: vi.fn(),
    openTypes: vi.fn(),
    openShare: vi.fn(),
    toggleTheme: vi.fn(),
  };
}

const baseState: CommandState = {
  workspaceSurface: true,
  readOnly: false,
  paletteOpen: false,
  libraryOpen: false,
  libraryTab: "cards",
  activeBoardId: "board-1",
  activeViewId: null,
  cardId: "c1",
  cardPlaced: true,
  boards: [
    { id: "board-1", name: "Board 1" },
    { id: "board-2", name: "Research" },
  ],
  views: [{ id: "v1", name: "Drafts" }],
  sections: [{ id: "s1", boardId: "board-1", title: "Act one" }],
  cards: [{ id: "c1", title: "Alpha", typeName: "Note" }],
  types: [
    { id: "note", name: "Note" },
    { id: "whiteboard", name: "Whiteboard" },
  ],
  trashedCount: 0,
};

function paletteContext(
  patch: {
    capabilities?: readonly Capability[];
    state?: Partial<CommandState>;
    actions?: Partial<CommandActions>;
  } = {},
): CommandContext {
  return {
    capabilities: patch.capabilities ?? allCapabilities,
    state: { ...baseState, ...patch.state },
    actions: { ...actions(), ...patch.actions },
  };
}

describe("buildPaletteItems", () => {
  it("should offer boards, views, sections, cards and actions", () => {
    const items = buildPaletteItems(paletteContext());
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
      paletteContext({ state: { boards: [{ id: "board-1", name: "Solo" }] } }),
    );
    expect(items.some((entry) => entry.group === "Boards")).toBe(false);
  });

  it("should hide creation entries a read-only session cannot run", () => {
    const items = buildPaletteItems(paletteContext({ capabilities: [] }));
    expect(items.some((entry) => entry.commandId === "board.create")).toBe(false);
    expect(items.some((entry) => entry.commandId === "card.create")).toBe(false);
    expect(items.some((entry) => entry.commandId === "schema.open")).toBe(false);
    // Reading and sharing stay available.
    expect(items.some((entry) => entry.commandId === "share.workspace")).toBe(true);
  });

  it("should route each row to the matching action", () => {
    const context = paletteContext();
    const items = buildPaletteItems(context);
    const run = (id: string) => items.find((entry) => entry.id === id)?.run();

    run("board.open:board-2");
    expect(context.actions.goToBoard).toHaveBeenCalledWith("board-2");

    run("section.focus:s1");
    expect(context.actions.goToSection).toHaveBeenCalledWith("s1");

    run("card.focus:c1");
    expect(context.actions.focusCard).toHaveBeenCalledWith("c1");

    run("card.create:note");
    expect(context.actions.createCard).toHaveBeenCalledWith("note");

    run("board.create");
    expect(context.actions.createBoard).toHaveBeenCalledOnce();
  });

  it("should trace every row to a registry command", () => {
    const ids = new Set(commands.map((command) => command.id));
    const items = buildPaletteItems(paletteContext({ state: { trashedCount: 1 } }));
    expect(items.length).toBeGreaterThan(0);
    for (const entry of items) {
      expect(entry.commandId, entry.id).toBeDefined();
      expect(ids.has(entry.commandId ?? ""), entry.id).toBe(true);
    }
  });
});

describe("CommandPalette", () => {
  const items = [
    item({
      id: "board.open:b2",
      title: "Research",
      subtitle: "Board",
      group: "Boards",
      weight: 10,
    }),
    item({ id: "theme.toggle", title: "Toggle the theme", group: "Actions", weight: 70 }),
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

  it("should put the highlight back on the best match when the query changes", () => {
    render(<CommandPalette items={items} onClose={() => {}} />);
    const rows = () => screen.getAllByTestId("command-palette-row");

    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "ArrowDown" });
    expect(rows()[1]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.change(screen.getByTestId("command-palette-input"), { target: { value: "e" } });

    expect(rows().length).toBeGreaterThan(1);
    expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("should close on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Typing immediately is the whole point of the surface: opening it and then
  // having to reach for the mouse would be a silent regression.
  it("should focus the search box the moment it opens", () => {
    render(<CommandPalette items={items} onClose={() => {}} />);
    expect(screen.getByTestId("command-palette-input")).toHaveFocus();
  });

  it("should render only rows that trace to a registry command", () => {
    const ids = new Set(commands.map((command) => command.id));
    render(<CommandPalette items={buildPaletteItems(paletteContext())} onClose={() => {}} />);
    const rows = screen.getAllByTestId("command-palette-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const commandId = row.getAttribute("data-command-id");
      expect(commandId, row.textContent ?? "").not.toBeNull();
      expect(ids.has(commandId ?? ""), row.textContent ?? "").toBe(true);
    }
  });
});

/**
 * The registry has always named each command's keys, and nothing printed them,
 * so the palette listed actions without saying how to reach them directly.
 */
describe("the palette's shortcut column", () => {
  it("prints the keys a row answers to", () => {
    const rows = buildPaletteItems(paletteContext());

    expect(rows.find((row) => row.commandId === "library.search")?.shortcut).toBe("\u2318\u21e7K");
    expect(rows.find((row) => row.commandId === "card.create")?.shortcut).toBe("\u2318Enter");
  });

  it("draws them beside the row", () => {
    const rows: PaletteItem[] = [
      item({ id: "palette.open", title: "Open the command palette", shortcut: "\u2318K" }),
      item({ id: "theme.toggle", title: "Toggle the theme" }),
    ];
    render(<CommandPalette items={rows} onClose={() => {}} />);

    const shortcuts = screen.getAllByTestId("palette-shortcut");
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]).toHaveTextContent("\u2318K");
  });
});
