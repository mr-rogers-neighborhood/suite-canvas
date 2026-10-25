import type { Board, Card, CardType, SavedView, Section } from "@suite/graph";
import { PORTAL_TYPE_ID } from "@suite/graph";
import type { PaletteItem } from "./paletteRank";

/**
 * Palette sources. Each provider is a pure function of a small input, so the
 * palette's contents can be tested without rendering it and a new source is a
 * function rather than a branch inside the component.
 *
 * Ordering of the groups is the order the providers are listed in
 * `buildPaletteItems`; within a group the matcher decides.
 */

export interface PaletteActions {
  goToBoard: (boardId: string) => void;
  goToSection: (sectionId: string) => void;
  focusCard: (cardId: string) => void;
  createCard: (typeId: string) => void;
  createBoard: () => void;
  openLibrary: () => void;
  openTypes: () => void;
  openShare: () => void;
  toggleTheme: () => void;
  /** Search the whole library, the surface `⌘⇧K` opens directly. */
  openLibrarySearch: () => void;
}

export interface PaletteInput {
  boards: readonly Board[];
  cards: readonly Card[];
  types: readonly CardType[];
  sections: readonly Section[];
  views: readonly SavedView[];
  activeBoardId: string | null;
  /** Live title for a card id; the palette shows what the board shows. */
  titleOf: (cardId: string) => string;
  /** Type name for a card, for the row's second line. */
  typeNameOf: (cardId: string) => string;
  canCreateContent: boolean;
  canCreateBoards: boolean;
  canManageSchema: boolean;
  actions: PaletteActions;
}

/** Cards beyond this are not indexed up front; search narrows into them. */
const CARD_LIST_LIMIT = 200;

export function boardItems(input: PaletteInput): PaletteItem[] {
  if (input.boards.length < 2) return [];
  return input.boards.map((board) => ({
    id: `board:${board.id}`,
    title: board.name || "Untitled board",
    subtitle: board.id === input.activeBoardId ? "Current board" : "Board",
    group: "Boards",
    weight: 10,
    keywords: ["board", "go", "open", board.id],
    run: () => input.actions.goToBoard(board.id),
  }));
}

export function viewItems(input: PaletteInput): PaletteItem[] {
  return input.views.map((view) => ({
    id: `view:${view.id}`,
    title: view.name,
    subtitle: "Saved view",
    group: "Views",
    weight: 20,
    keywords: ["view", "query", "lens", "filter"],
    run: () => input.actions.openLibrary(),
  }));
}

export function sectionItems(input: PaletteInput): PaletteItem[] {
  const onBoard = input.sections.filter((section) => section.boardId === input.activeBoardId);
  return onBoard.map((section) => ({
    id: `section:${section.id}`,
    title: section.title || "Untitled section",
    subtitle: "Section on this board",
    group: "Sections",
    weight: 30,
    keywords: ["section", "region"],
    run: () => input.actions.goToSection(section.id),
  }));
}

export function cardItems(input: PaletteInput): PaletteItem[] {
  const visible = input.cards.slice(0, CARD_LIST_LIMIT);
  return visible.map((card) => ({
    id: `card:${card.id}`,
    title: input.titleOf(card.id),
    subtitle: input.typeNameOf(card.id),
    group: "Cards",
    weight: 40,
    keywords: ["card", "find", card.id],
    run: () => input.actions.focusCard(card.id),
  }));
}

export function actionItems(input: PaletteInput): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: "action:library-search",
      title: "Search every card",
      subtitle: "Library search · ⌘⇧K",
      group: "Actions",
      weight: 5,
      keywords: ["search", "find", "library", "all"],
      run: () => input.actions.openLibrarySearch(),
    },
    {
      id: "action:library",
      title: "Open the library",
      subtitle: "Inbox, cards and trash",
      group: "Actions",
      weight: 60,
      keywords: ["library", "inbox", "trash", "drawer"],
      run: () => input.actions.openLibrary(),
    },
    {
      id: "action:theme",
      title: "Toggle the theme",
      subtitle: "Light, dark or system",
      group: "Actions",
      weight: 70,
      keywords: ["theme", "dark", "light", "appearance", "mode"],
      run: () => input.actions.toggleTheme(),
    },
  ];

  if (input.canCreateBoards) {
    items.push({
      id: "action:new-board",
      title: "New board",
      group: "Actions",
      weight: 55,
      keywords: ["board", "create", "add", "new"],
      run: () => input.actions.createBoard(),
    });
  }

  if (input.canCreateContent) {
    for (const type of input.types) {
      // A portal needs a target board, which the palette cannot ask for inline;
      // the dock's menu owns that shape.
      if (type.id === PORTAL_TYPE_ID) continue;
      items.push({
        id: `action:new:${type.id}`,
        title: `New ${type.name.toLowerCase()}`,
        subtitle: "Card on this board",
        group: "Create",
        weight: 50,
        keywords: ["new", "create", "add", type.name.toLowerCase()],
        run: () => input.actions.createCard(type.id),
      });
    }
  }

  if (input.canManageSchema) {
    items.push({
      id: "action:types",
      title: "Types, fields and tags",
      group: "Actions",
      weight: 80,
      keywords: ["types", "fields", "tags", "schema", "settings"],
      run: () => input.actions.openTypes(),
    });
  }

  items.push({
    id: "action:share",
    title: "Share this workspace",
    group: "Actions",
    weight: 75,
    keywords: ["share", "publish", "link", "invite"],
    run: () => input.actions.openShare(),
  });

  return items;
}

export function buildPaletteItems(input: PaletteInput): PaletteItem[] {
  return [
    ...actionItems(input),
    ...boardItems(input),
    ...viewItems(input),
    ...sectionItems(input),
    ...cardItems(input),
  ];
}
