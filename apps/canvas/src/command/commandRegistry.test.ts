import { PORTAL_TYPE_ID } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import {
  allCapabilities,
  type Capability,
  type CommandActions,
  type CommandContext,
  type CommandState,
  commandGroups,
  commandOwners,
  commands,
  commandsFor,
  paletteInvocations,
} from "./commandRegistry";
import { buildPaletteItems } from "./paletteProviders";

const baseState: CommandState = {
  workspaceSurface: true,
  readOnly: false,
  paletteOpen: false,
  libraryOpen: false,
  libraryTab: "cards",
  activeBoardId: "board-1",
  activeViewId: null,
  cardId: "card-1",
  cardPlaced: true,
  boards: [
    { id: "board-1", name: "Board 1" },
    { id: "board-2", name: "Research" },
  ],
  views: [{ id: "view-1", name: "Drafts" }],
  sections: [{ id: "section-1", boardId: "board-1", title: "Act one" }],
  cards: [{ id: "card-1", title: "Alpha", typeName: "Note" }],
  types: [
    { id: "note", name: "Note" },
    { id: "whiteboard", name: "Whiteboard" },
    { id: PORTAL_TYPE_ID, name: "Portal" },
  ],
  trashedCount: 0,
};

function actions(overrides: Partial<CommandActions> = {}): CommandActions {
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
    createPortalOnBoard: vi.fn(),
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
    arrangeRadial: vi.fn(),
    installBlueprint: vi.fn(),
    ...overrides,
  };
}

function commandContext(
  options: { capabilities?: readonly Capability[]; state?: Partial<CommandState> } = {},
): CommandContext {
  return {
    capabilities: options.capabilities ?? allCapabilities,
    state: { ...baseState, ...options.state },
    actions: actions(),
  };
}

/** What a command needs to be available, and what takes that away. */
interface Fixture {
  /** Extra context for the "it can run" case; capabilities default to all of them. */
  available?: { capabilities?: readonly Capability[]; state?: Partial<CommandState> } | undefined;
  /** The smallest change that makes `available()` false. */
  unavailable: { capabilities?: readonly Capability[]; state?: Partial<CommandState> };
}

const fixtures: Readonly<Record<string, Fixture>> = {
  "palette.open": { unavailable: { state: { paletteOpen: true } } },
  "library.open": { unavailable: { state: { workspaceSurface: false } } },
  "library.search": { unavailable: { state: { workspaceSurface: false } } },
  "library.tab.inbox": { unavailable: { state: { libraryTab: "inbox" } } },
  "library.tab.cards": {
    available: { state: { libraryTab: "inbox" } },
    unavailable: { state: { libraryTab: "cards" } },
  },
  "library.tab.trash": { unavailable: { state: { libraryTab: "trash" } } },
  "theme.toggle": { unavailable: { state: { workspaceSurface: false } } },
  "board.create": { unavailable: { capabilities: [] } },
  "card.create": { unavailable: { capabilities: [] } },
  "share.workspace": { unavailable: { state: { workspaceSurface: false } } },
  "schema.open": { unavailable: { capabilities: [] } },
  "board.open": { unavailable: { state: { boards: [{ id: "board-1", name: "Solo" }] } } },
  "view.open": { unavailable: { state: { views: [] } } },
  "view.apply": { unavailable: { state: { views: [] } } },
  "view.exit": {
    available: { state: { activeViewId: "view-1" } },
    unavailable: { state: { activeViewId: null } },
  },
  "section.focus": { unavailable: { state: { sections: [] } } },
  "card.focus": { unavailable: { state: { cards: [] } } },
  "card.createSketch": { unavailable: { capabilities: [] } },
  "section.create": { unavailable: { capabilities: [] } },
  "portal.create": { unavailable: { state: { activeBoardId: null } } },
  "card.edit": { unavailable: { capabilities: [] } },
  "card.setType": { unavailable: { capabilities: [] } },
  "card.trash": { unavailable: { state: { cardId: null } } },
  "card.restore": {
    available: { state: { trashedCount: 1 } },
    unavailable: { state: { trashedCount: 0 } },
  },
  "card.deleteForever": {
    available: { state: { trashedCount: 1 } },
    unavailable: { state: { trashedCount: 0 } },
  },
  "library.emptyTrash": {
    available: { state: { trashedCount: 1 } },
    unavailable: { state: { trashedCount: 0 } },
  },
  "library.newCard": {
    available: { state: { libraryTab: "inbox" } },
    unavailable: { state: { libraryTab: "cards" } },
  },
  "library.placeCard": { unavailable: { state: { cardId: null } } },
  "card.duplicate": { unavailable: { state: { cardId: null } } },
  "card.removeFromBoard": { unavailable: { state: { cardPlaced: false } } },
  "layout.arrangeRadial": { unavailable: { state: { cardId: null } } },
  "type.installBlueprint": { unavailable: { state: { cardId: null } } },
  "workspace.exportBackup": { unavailable: { state: { workspaceSurface: false } } },
  "share.publish": { unavailable: { capabilities: [] } },
};

describe("commands", () => {
  it("should give every command a unique id, a label, a group, an owner and a run", () => {
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) {
      expect(command.label.trim(), command.id).not.toBe("");
      expect(commandGroups, command.id).toContain(command.group);
      expect(commandOwners, command.id).toContain(command.owner);
      expect(command.shortcut?.trim(), command.id).not.toBe("");
      // Every command does something: it runs, or it names objects to run on.
      expect(Boolean(command.run ?? command.expand), command.id).toBe(true);
    }
  });

  it("should name only capabilities the session matrix has", () => {
    for (const command of commands) {
      for (const capability of command.capabilities) {
        expect(allCapabilities, command.id).toContain(capability);
      }
      expect(new Set(command.capabilities).size, command.id).toBe(command.capabilities.length);
    }
  });

  it("should give every palette-owned command a palette row", () => {
    for (const command of commands) {
      if (command.owner === "palette") expect(command.palette, command.id).toBeDefined();
    }
  });

  it("should let a canvas-owned create command reach the palette too", () => {
    // The dock and the canvas are not the only place a create action belongs:
    // the palette lists the same command, so one table answers "where can I do
    // this?" for every surface.
    for (const id of ["card.createSketch", "section.create", "portal.create"]) {
      expect(commands.find((command) => command.id === id)?.palette, id).toBeDefined();
    }
  });

  it("should give every owner at least one command", () => {
    for (const owner of commandOwners) {
      expect(commands.filter((command) => command.owner === owner).length, owner).toBeGreaterThan(
        0,
      );
    }
  });

  it("should have a fixture for every command, and only for commands", () => {
    expect(Object.keys(fixtures).sort()).toEqual(commands.map((command) => command.id).sort());
  });
});

describe.each(commands.map((command) => [command.id, command] as const))("%s", (id, command) => {
  const fixture = fixtures[id];

  it("should be available when its conditions hold", () => {
    expect(fixture, `no fixture for ${id}`).toBeDefined();
    const context = commandContext(fixture?.available ?? {});
    expect(command.available(context)).toBe(true);
    expect(
      commandsFor(command.owner, context).map((entry) => entry.id),
      `${id} is not listed by its owner`,
    ).toContain(id);
  });

  it("should be unavailable when they do not", () => {
    expect(fixture, `no fixture for ${id}`).toBeDefined();
    const context = commandContext(fixture?.unavailable ?? {});
    expect(command.available(context)).toBe(false);
    expect(commandsFor(command.owner, context).map((entry) => entry.id)).not.toContain(id);
  });
});

describe("commandsFor", () => {
  it("should only return commands whose capabilities the session holds", () => {
    for (const owner of commandOwners) {
      for (const command of commandsFor(owner, commandContext({ capabilities: [] }))) {
        expect(command.capabilities, command.id).toEqual([]);
      }
    }
  });

  it("should hide capability-gated palette rows from a session that lacks them", () => {
    const ids = commandsFor("palette", commandContext({ capabilities: [] })).map(
      (command) => command.id,
    );
    expect(ids).not.toContain("board.create");
    expect(ids).not.toContain("card.create");
    expect(ids).not.toContain("schema.open");
    // Reading, searching and sharing need no write capability.
    expect(ids).toContain("library.open");
    expect(ids).toContain("library.search");
    expect(ids).toContain("share.workspace");
  });

  it("should keep registry order", () => {
    const ids = commandsFor("palette", commandContext()).map((command) => command.id);
    const ordered = commands.filter((command) => ids.includes(command.id)).map((entry) => entry.id);
    expect(ids).toEqual(ordered);
  });
});

describe("paletteInvocations", () => {
  it("should render at least one row for every palette command", () => {
    for (const command of commands.filter((entry) => entry.palette !== undefined)) {
      const context = commandContext(fixtures[command.id]?.available ?? {});
      expect(
        paletteInvocations(context).some((row) => row.commandId === command.id),
        command.id,
      ).toBe(true);
    }
  });

  it("should name one row per object and keep the names unique", () => {
    const rows = paletteInvocations(commandContext({ state: { trashedCount: 1 } }));
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.map((row) => row.label)).toEqual(
      expect.arrayContaining(["Research", "Drafts", "Act one", "Alpha", "New note", "New board"]),
    );
    // A portal names its target in the row, so the palette can offer one without
    // a second control: every portal row is "New portal to <board>".
    const portals = rows.filter((row) => row.commandId === "portal.create");
    expect(portals.map((row) => row.label)).toEqual(["New portal to Research"]);
    expect(portals[0]?.id).toBe("portal.create:board-2");
  });

  it("should not list a command twice for the same object", () => {
    const rows = paletteInvocations(commandContext());
    const perCommand = new Map<string, number>();
    for (const row of rows) perCommand.set(row.commandId, (perCommand.get(row.commandId) ?? 0) + 1);
    expect(perCommand.get("board.open")).toBe(baseState.boards.length);
    expect(perCommand.get("card.focus")).toBe(baseState.cards.length);
  });

  it("should trace every palette row to a registry command", () => {
    const ids = new Set(commands.map((command) => command.id));
    for (const item of buildPaletteItems(commandContext())) {
      expect(item.commandId, item.id).toBeDefined();
      expect(ids.has(item.commandId ?? ""), item.id).toBe(true);
    }
  });
});
