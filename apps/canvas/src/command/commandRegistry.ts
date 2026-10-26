import { PORTAL_TYPE_ID } from "@suite/graph";
import type { SessionCapabilities } from "../session/session";
import type { LibraryTab } from "../store/useUiStore";

/**
 * Every user-invokable action, described once.
 *
 * The palette, the library, the inspector and the canvas name the same things:
 * "open this board", "trash this card", "new note". One table makes availability
 * a property of the command rather than a branch inside each surface, and turns
 * "does this option still work?" into a table-driven test
 * (`commandRegistry.test.ts`) instead of a per-component one.
 *
 * A definition says *what* can happen and *when*; `paletteProviders` projects it
 * into rows. Availability is one rule everywhere: every listed capability must
 * be granted, and the surface predicate must hold.
 */

/** A capability flag from the session matrix; the same names the store holds. */
export type Capability = keyof SessionCapabilities;

export const allCapabilities: readonly Capability[] = [
  "canEditContent",
  "canEditLayout",
  "canPublish",
  "canCreateContent",
  "canCreateBoards",
  "canManageBoards",
  "canManageSchema",
  "canManageTrash",
  "canManageLinks",
];

export const commandGroups = ["navigation", "create", "edit", "layout", "view", "system"] as const;
export type CommandGroup = (typeof commandGroups)[number];

/** Which surface lists the command. */
export const commandOwners = ["palette", "library", "inspector", "canvas"] as const;
export type CommandOwner = (typeof commandOwners)[number];

/** One board, as a command can name it. */
export interface BoardChoice {
  id: string;
  name: string;
}

/** One saved view, as a command can name it. */
export interface ViewChoice {
  id: string;
  name: string;
}

/** One section on the active board. */
export interface SectionChoice {
  id: string;
  boardId: string;
  title: string;
}

/** One card, with the two lines a command row reads. */
export interface CardChoice {
  id: string;
  title: string;
  typeName: string;
}

/** One card type, as card creation and type assignment name it. */
export interface TypeChoice {
  id: string;
  name: string;
}

/**
 * What availability needs: the selection, the open surfaces and the objects the
 * commands can name. Document truth stays in the CRDT; this is a snapshot.
 */
export interface CommandState {
  /** The workspace shell is on screen; library, palette and schema live here. */
  workspaceSurface: boolean;
  readOnly: boolean;
  paletteOpen: boolean;
  libraryOpen: boolean;
  libraryTab: LibraryTab;
  activeBoardId: string | null;
  activeViewId: string | null;
  /** The card a card-scoped command acts on, when one is open or selected. */
  cardId: string | null;
  /** Whether that card sits on the active board, so it can be taken off it. */
  cardPlaced: boolean;
  boards: readonly BoardChoice[];
  views: readonly ViewChoice[];
  sections: readonly SectionChoice[];
  cards: readonly CardChoice[];
  types: readonly TypeChoice[];
  trashedCount: number;
}

/**
 * What the shell can do. Each command calls exactly one handler, so a surface
 * adopts a command by supplying the handler it already owns.
 */
export interface CommandActions {
  openPalette(): void;
  openLibrary(): void;
  openLibraryTab(tab: LibraryTab): void;
  searchLibrary(): void;
  goToBoard(boardId: string): void;
  goToSection(sectionId: string): void;
  focusCard(cardId: string): void;
  openCard(cardId: string): void;
  applyView(viewId: string): void;
  exitView(): void;
  createCard(typeId: string): void;
  /** An inbox card: it has no board placement until the reader places it. */
  createCardInInbox(): void;
  createSketch(): void;
  createSection(): void;
  /**
   * A portal on the active board that opens `targetBoardId`. Optional until the
   * shell supplies it: without a handler the portal rows are not offered, so the
   * palette never lists a command that cannot run.
   */
  createPortalOnBoard?: ((targetBoardId: string) => void) | undefined;
  createBoard(): void;
  editCard(cardId: string): void;
  setCardType(cardId: string, typeId: string): void;
  trashCard(cardId: string): void;
  restoreCard(cardId: string): void;
  deleteCardForever(cardId: string): void;
  emptyTrash(): void;
  duplicateCard(cardId: string): void;
  removeFromBoard(cardId: string): void;
  placeCard(cardId: string): void;
  openTypes(): void;
  openShare(): void;
  toggleTheme(): void;
  /**
   * Arranges the selected card and its subtree on rings (`radialLayout`). Optional
   * until the board supplies it: a mind map needs the board's placements, so the
   * command is listed only where a surface can actually run it.
   */
  arrangeRadial?: (() => void) | undefined;
  /**
   * Installs the selected card as a type blueprint: its title names the type, its body
   * declares the fields (`installBlueprintCard`). Optional for the same reason: without a
   * handler the row is never listed.
   */
  installBlueprint?: (() => void) | undefined;
  /**
   * The File menu owns the export dialog, and the publish control owns the
   * draft hand-off; both wire their own handler when they read this table.
   */
  exportBackup?: (() => void) | undefined;
  publish?: (() => void) | undefined;
}

export interface CommandContext {
  capabilities: readonly Capability[];
  state: CommandState;
  actions: CommandActions;
}

/** How the palette prints one command. */
export interface PaletteMeta {
  /** Heading the row sits under. */
  group: string;
  /** Lower runs first among equal scores. */
  weight: number;
  subtitle?: string | undefined;
  keywords?: readonly string[] | undefined;
}

/** One object a command names: a board, a saved view, a card, a type. */
export interface CommandTarget {
  /** Suffix that keeps the row id unique: the object's id. */
  key: string;
  label: string;
  subtitle?: string | undefined;
  keywords?: readonly string[] | undefined;
  weight?: number | undefined;
  run(context: CommandContext): void;
}

export interface CommandDefinition {
  /** Stable and unique, e.g. `board.open`, `card.trash`. */
  id: string;
  label: string;
  group: CommandGroup;
  shortcut?: string | undefined;
  owner: CommandOwner;
  /** Every flag a session must hold before the command can run. */
  capabilities: readonly Capability[];
  available(context: CommandContext): boolean;
  /**
   * What running it does. A command that only names objects (`expand`) has no
   * single target, so it runs through the row it targets instead.
   */
  run?: ((context: CommandContext) => void) | undefined;
  /** The palette row; absent means the palette never lists it. */
  palette?: PaletteMeta | undefined;
  /** One row per object, when the command names an object. */
  expand?: ((context: CommandContext) => readonly CommandTarget[]) | undefined;
}

/** A ready-to-run row: a command, bound to the object it names. */
export interface CommandInvocation {
  /** The registry command this row instantiates. */
  commandId: string;
  /** Unique row id, `board.open:<boardId>`; also the palette row's key. */
  id: string;
  label: string;
  subtitle?: string | undefined;
  group: string;
  weight: number;
  keywords: readonly string[];
  run: () => void;
}

/** Cards beyond this are not indexed up front; search narrows into them. */
export const CARD_LIST_LIMIT = 200;

function granted(context: CommandContext, required: readonly Capability[]): boolean {
  return required.every((capability) => context.capabilities.includes(capability));
}

/** Builds a definition whose availability always starts with its capabilities. */
function define(
  command: Omit<CommandDefinition, "available"> & {
    available?: ((context: CommandContext) => boolean) | undefined;
  },
): CommandDefinition {
  const required = command.capabilities;
  return {
    ...command,
    available: (context) =>
      granted(context, required) && (command.available ? command.available(context) : true),
  };
}

const onWorkspace = (context: CommandContext) => context.state.workspaceSurface;
const onBoard = (context: CommandContext) => context.state.activeBoardId !== null;
const onCard = (context: CommandContext) => context.state.cardId !== null;
const hasTrash = (context: CommandContext) =>
  context.state.workspaceSurface && context.state.trashedCount > 0;

export const commands: readonly CommandDefinition[] = [
  define({
    id: "palette.open",
    label: "Open the command palette",
    group: "navigation",
    shortcut: "⌘K",
    owner: "canvas",
    capabilities: [],
    available: (context) => !context.state.paletteOpen,
    run: (context) => context.actions.openPalette(),
  }),
  define({
    id: "library.open",
    label: "Open the library",
    group: "navigation",
    owner: "palette",
    capabilities: [],
    available: onWorkspace,
    palette: {
      group: "Actions",
      weight: 60,
      subtitle: "Inbox, cards and trash",
      keywords: ["library", "inbox", "trash", "drawer"],
    },
    run: (context) => context.actions.openLibrary(),
  }),
  define({
    id: "library.search",
    label: "Search every card",
    group: "navigation",
    shortcut: "⌘⇧K",
    owner: "palette",
    capabilities: [],
    available: onWorkspace,
    palette: {
      group: "Actions",
      weight: 5,
      subtitle: "Library search · ⌘⇧K",
      keywords: ["search", "find", "library", "all"],
    },
    run: (context) => context.actions.searchLibrary(),
  }),
  define({
    id: "library.tab.inbox",
    label: "Show the inbox",
    group: "navigation",
    owner: "library",
    capabilities: [],
    available: (context) => context.state.libraryTab !== "inbox",
    run: (context) => context.actions.openLibraryTab("inbox"),
  }),
  define({
    id: "library.tab.cards",
    label: "Show every card",
    group: "navigation",
    owner: "library",
    capabilities: [],
    available: (context) => context.state.libraryTab !== "cards",
    run: (context) => context.actions.openLibraryTab("cards"),
  }),
  define({
    id: "library.tab.trash",
    label: "Show the trash",
    group: "navigation",
    owner: "library",
    capabilities: [],
    available: (context) => context.state.libraryTab !== "trash",
    run: (context) => context.actions.openLibraryTab("trash"),
  }),
  define({
    id: "theme.toggle",
    label: "Toggle the theme",
    group: "system",
    owner: "palette",
    capabilities: [],
    available: onWorkspace,
    palette: {
      group: "Actions",
      weight: 70,
      subtitle: "Light, dark or system",
      keywords: ["theme", "dark", "light", "appearance", "mode"],
    },
    run: (context) => context.actions.toggleTheme(),
  }),
  define({
    id: "board.create",
    label: "New board",
    group: "create",
    owner: "palette",
    capabilities: ["canCreateBoards"],
    available: onWorkspace,
    palette: {
      group: "Actions",
      weight: 55,
      keywords: ["board", "create", "add", "new"],
    },
    run: (context) => context.actions.createBoard(),
  }),
  define({
    id: "card.create",
    label: "New card",
    group: "create",
    owner: "palette",
    capabilities: ["canCreateContent"],
    available: (context) => onBoard(context) && context.state.types.length > 0,
    palette: {
      group: "Create",
      weight: 50,
      subtitle: "Card on this board",
      keywords: ["new", "create", "add"],
    },
    expand: (context) =>
      context.state.types
        // A portal needs a target board, which the palette cannot ask for
        // inline; the dock's menu owns that shape.
        .filter((type) => type.id !== PORTAL_TYPE_ID)
        .map((type) => ({
          key: type.id,
          label: `New ${type.name.toLowerCase()}`,
          subtitle: "Card on this board",
          keywords: ["new", "create", "add", type.name.toLowerCase()],
          weight: 50,
          run: (live) => live.actions.createCard(type.id),
        })),
  }),
  define({
    id: "share.workspace",
    label: "Share this workspace",
    group: "system",
    owner: "palette",
    capabilities: [],
    available: onWorkspace,
    palette: {
      group: "Actions",
      weight: 75,
      keywords: ["share", "publish", "link", "invite"],
    },
    run: (context) => context.actions.openShare(),
  }),
  define({
    id: "schema.open",
    label: "Types, fields and tags",
    group: "system",
    owner: "palette",
    capabilities: ["canManageSchema"],
    available: onWorkspace,
    palette: {
      group: "Actions",
      weight: 80,
      keywords: ["types", "fields", "tags", "schema", "settings"],
    },
    run: (context) => context.actions.openTypes(),
  }),
  define({
    id: "board.open",
    label: "Open board",
    group: "navigation",
    owner: "palette",
    capabilities: [],
    // One board is where the reader already is, so there is nowhere to go.
    available: (context) => onWorkspace(context) && context.state.boards.length > 1,
    palette: { group: "Boards", weight: 10, keywords: ["board", "go", "open"] },
    expand: (context) =>
      context.state.boards.map((board) => ({
        key: board.id,
        label: board.name || "Untitled board",
        subtitle: board.id === context.state.activeBoardId ? "Current board" : "Board",
        keywords: ["board", "go", "open", board.id],
        weight: 10,
        run: (live) => live.actions.goToBoard(board.id),
      })),
  }),
  define({
    id: "view.open",
    label: "Open view",
    group: "view",
    owner: "palette",
    capabilities: [],
    available: (context) => onWorkspace(context) && context.state.views.length > 0,
    palette: { group: "Views", weight: 20, keywords: ["view", "query", "lens", "filter"] },
    // A row opens the library it filters, exactly as it always has.
    expand: (context) =>
      context.state.views.map((view) => ({
        key: view.id,
        label: view.name,
        subtitle: "Saved view",
        keywords: ["view", "query", "lens", "filter"],
        weight: 20,
        run: (live) => live.actions.openLibrary(),
      })),
  }),
  define({
    id: "view.apply",
    label: "Apply view",
    group: "view",
    owner: "canvas",
    capabilities: [],
    available: (context) => onWorkspace(context) && context.state.views.length > 0,
    expand: (context) =>
      context.state.views.map((view) => ({
        key: view.id,
        label: view.name,
        subtitle: "Saved view",
        weight: 20,
        run: (live) => live.actions.applyView(view.id),
      })),
  }),
  define({
    id: "view.exit",
    label: "Clear the current view",
    group: "view",
    owner: "canvas",
    capabilities: [],
    available: (context) => context.state.activeViewId !== null,
    run: (context) => context.actions.exitView(),
  }),
  define({
    id: "section.focus",
    label: "Go to section",
    group: "navigation",
    owner: "palette",
    capabilities: [],
    available: (context) =>
      context.state.sections.some((section) => section.boardId === context.state.activeBoardId),
    palette: { group: "Sections", weight: 30, keywords: ["section", "region"] },
    expand: (context) =>
      context.state.sections
        .filter((section) => section.boardId === context.state.activeBoardId)
        .map((section) => ({
          key: section.id,
          label: section.title || "Untitled section",
          subtitle: "Section on this board",
          keywords: ["section", "region"],
          weight: 30,
          run: (live) => live.actions.goToSection(section.id),
        })),
  }),
  define({
    id: "card.focus",
    label: "Go to card",
    group: "navigation",
    owner: "palette",
    capabilities: [],
    available: (context) => onWorkspace(context) && context.state.cards.length > 0,
    palette: { group: "Cards", weight: 40, keywords: ["card", "find"] },
    expand: (context) =>
      context.state.cards.slice(0, CARD_LIST_LIMIT).map((card) => ({
        key: card.id,
        label: card.title,
        subtitle: card.typeName,
        keywords: ["card", "find", card.id],
        weight: 40,
        run: (live) => live.actions.focusCard(card.id),
      })),
  }),
  define({
    id: "card.createSketch",
    label: "New sketch",
    group: "create",
    owner: "canvas",
    capabilities: ["canCreateContent"],
    available: onBoard,
    // The canvas and the dock already own this action; the palette lists the
    // same command rather than growing a create menu of its own.
    palette: {
      group: "Create",
      weight: 52,
      subtitle: "On this board",
      keywords: ["sketch", "whiteboard", "draw", "new", "create"],
    },
    run: (context) => context.actions.createSketch(),
  }),
  define({
    id: "section.create",
    label: "New section",
    group: "create",
    owner: "canvas",
    capabilities: ["canCreateContent"],
    available: onBoard,
    palette: {
      group: "Create",
      weight: 54,
      subtitle: "On this board",
      keywords: ["section", "region", "frame", "new", "create"],
    },
    run: (context) => context.actions.createSection(),
  }),
  define({
    id: "portal.create",
    label: "New portal",
    group: "create",
    owner: "canvas",
    capabilities: ["canCreateContent"],
    // A portal is a card that opens a board, so the target is part of the
    // command: the palette names one row per board instead of asking a question
    // it has no control for.
    available: (context) => onBoard(context) && context.actions.createPortalOnBoard !== undefined,
    palette: {
      group: "Create",
      weight: 56,
      keywords: ["portal", "board", "open", "new", "create"],
    },
    expand: (context) =>
      context.state.boards
        .filter((board) => board.id !== context.state.activeBoardId)
        .map((board) => ({
          key: board.id,
          label: `New portal to ${board.name || "Untitled board"}`,
          subtitle: "Card on this board",
          keywords: ["portal", "board", "open", "new", "create", board.id],
          weight: 56,
          run: (live) => live.actions.createPortalOnBoard?.(board.id),
        })),
  }),
  define({
    id: "card.edit",
    label: "Edit card",
    group: "edit",
    owner: "inspector",
    capabilities: ["canEditContent"],
    available: onCard,
    run: (context) => {
      if (context.state.cardId) context.actions.editCard(context.state.cardId);
    },
  }),
  define({
    id: "card.setType",
    label: "Set card type",
    group: "edit",
    owner: "inspector",
    capabilities: ["canManageSchema"],
    available: onCard,
    expand: (context) =>
      context.state.types.map((type) => ({
        key: type.id,
        label: `Set type to ${type.name}`,
        weight: 40,
        run: (live) => {
          if (live.state.cardId) live.actions.setCardType(live.state.cardId, type.id);
        },
      })),
  }),
  define({
    id: "card.trash",
    label: "Move to the trash",
    group: "edit",
    owner: "library",
    capabilities: ["canManageTrash"],
    available: (context) => onWorkspace(context) && onCard(context),
    run: (context) => {
      if (context.state.cardId) context.actions.trashCard(context.state.cardId);
    },
  }),
  define({
    id: "card.restore",
    label: "Restore from the trash",
    group: "edit",
    owner: "library",
    capabilities: ["canManageTrash"],
    available: (context) => hasTrash(context) && onCard(context),
    run: (context) => {
      if (context.state.cardId) context.actions.restoreCard(context.state.cardId);
    },
  }),
  define({
    id: "card.deleteForever",
    label: "Delete forever",
    group: "edit",
    owner: "library",
    capabilities: ["canManageTrash"],
    available: (context) => hasTrash(context) && onCard(context),
    run: (context) => {
      if (context.state.cardId) context.actions.deleteCardForever(context.state.cardId);
    },
  }),
  define({
    id: "library.emptyTrash",
    label: "Empty the trash",
    group: "edit",
    owner: "library",
    capabilities: ["canManageTrash"],
    available: hasTrash,
    run: (context) => context.actions.emptyTrash(),
  }),
  define({
    id: "library.newCard",
    label: "New card in the inbox",
    group: "create",
    owner: "library",
    capabilities: ["canCreateContent"],
    // The library's "New" button exists on the inbox tab, and nowhere else.
    available: (context) =>
      onWorkspace(context) && context.state.libraryTab === "inbox" && !context.state.readOnly,
    run: (context) => context.actions.createCardInInbox(),
  }),
  define({
    id: "library.placeCard",
    label: "Place on the board",
    group: "layout",
    owner: "library",
    capabilities: ["canEditLayout"],
    available: (context) => onBoard(context) && onWorkspace(context) && onCard(context),
    run: (context) => {
      if (context.state.cardId) context.actions.placeCard(context.state.cardId);
    },
  }),
  define({
    id: "card.duplicate",
    label: "Duplicate card",
    group: "edit",
    owner: "canvas",
    capabilities: ["canCreateContent"],
    available: onCard,
    run: (context) => {
      if (context.state.cardId) context.actions.duplicateCard(context.state.cardId);
    },
  }),
  define({
    id: "card.removeFromBoard",
    label: "Remove from this board",
    group: "layout",
    owner: "inspector",
    capabilities: ["canEditLayout"],
    available: (context) => onBoard(context) && onCard(context) && context.state.cardPlaced,
    run: (context) => {
      if (context.state.cardId) context.actions.removeFromBoard(context.state.cardId);
    },
  }),
  define({
    id: "layout.arrangeRadial",
    label: "Arrange as a mind map",
    group: "layout",
    owner: "canvas",
    capabilities: ["canEditLayout"],
    // The command needs a root and a board to lay it out on, and a handler to run it.
    available: (context) =>
      onBoard(context) && onCard(context) && context.actions.arrangeRadial !== undefined,
    palette: {
      group: "Layout",
      weight: 62,
      subtitle: "This card and its links, on rings",
      keywords: ["mind map", "mindmap", "radial", "arrange", "layout", "tree", "branch"],
    },
    run: (context) => context.actions.arrangeRadial?.(),
  }),
  define({
    id: "type.installBlueprint",
    label: "Install this blueprint",
    group: "create",
    owner: "canvas",
    capabilities: ["canManageSchema"],
    available: (context) =>
      onBoard(context) && onCard(context) && context.actions.installBlueprint !== undefined,
    palette: {
      group: "Create",
      weight: 58,
      subtitle: "The selected card names a type; its body declares the fields",
      keywords: ["blueprint", "type", "schema", "install", "template", "fields"],
    },
    run: (context) => context.actions.installBlueprint?.(),
  }),
  define({
    id: "workspace.exportBackup",
    label: "Export a backup",
    group: "system",
    owner: "canvas",
    capabilities: [],
    available: onWorkspace,
    run: (context) => context.actions.exportBackup?.(),
  }),
  define({
    id: "share.publish",
    label: "Publish this draft",
    group: "system",
    owner: "canvas",
    capabilities: ["canPublish"],
    available: onWorkspace,
    run: (context) => context.actions.publish?.(),
  }),
];

/** The commands a surface lists, in registry order, once the context allows them. */
export function commandsFor(owner: CommandOwner, context: CommandContext): CommandDefinition[] {
  return commands.filter(
    (command) =>
      command.owner === owner &&
      granted(context, command.capabilities) &&
      command.available(context),
  );
}

/** The palette's rows: every palette command, one row per named object. */
export function paletteInvocations(context: CommandContext): CommandInvocation[] {
  const rows: CommandInvocation[] = [];
  // A palette row is a property of the command, not of its owner: "New sketch"
  // belongs to the canvas and the dock and is also reachable from the palette.
  for (const command of commands) {
    const meta = command.palette;
    if (!meta) continue;
    if (!granted(context, command.capabilities) || !command.available(context)) continue;
    const run = command.run;
    const targets = command.expand?.(context);
    if (!targets) {
      // A command with neither a target nor a run cannot be listed; the
      // registry test fails a definition like that loudly.
      if (!run) continue;
      rows.push({
        commandId: command.id,
        id: command.id,
        label: command.label,
        ...(meta.subtitle ? { subtitle: meta.subtitle } : {}),
        group: meta.group,
        weight: meta.weight,
        keywords: meta.keywords ?? [],
        run: () => run(context),
      });
      continue;
    }
    for (const target of targets) {
      rows.push({
        commandId: command.id,
        id: `${command.id}:${target.key}`,
        label: target.label,
        ...(target.subtitle ? { subtitle: target.subtitle } : {}),
        group: meta.group,
        weight: target.weight ?? meta.weight,
        keywords: target.keywords ?? meta.keywords ?? [],
        run: () => target.run(context),
      });
    }
  }
  return rows;
}
