import type {
  CardType,
  PropertyValue,
  Tag,
  WorkspaceDocument,
  WorkspaceMediaItem,
} from "@suite/graph";
import type { CanvasMode } from "../canvas/links/linkGesture";
import type { LibraryScope, LibraryTab } from "../store/useUiStore";
import type { SectionOrderEntry } from "./libraryFilters";
import type { BoardStarter } from "./TemplateGallery";

export interface LibraryItem {
  id: string;
  title: string;
  /**
   * What kind of thing this row is.
   *
   * A board is not a card — it has no type of its own, no fields and no
   * placement of its own — but in the library it behaves like one: it is
   * searchable, filterable, selectable and draggable. Rather than keep a second
   * list with a second set of actions, a board is an item whose type is
   * `"board"`, so every facet, sort and selection works on it unchanged.
   */
  kind?: "card" | "board";
  boards: Array<{ id: string; name: string }>;
  typeIds: string[];
  tagIds: string[];
  /** The card's section on the scoped board plus its ancestors, innermost first. */
  sectionIds: string[];
  properties: Record<string, PropertyValue>;
}

/**
 * A board in the library's Boards section. A board has a name and placements —
 * no types, tags or fields (ADR-0040), so it is its own row shape rather than a
 * `LibraryItem` with invented values.
 */
export interface LibraryBoard {
  id: string;
  title: string;
  /** When the board last changed; orders the list when a reader asks by date. */
  updatedAt?: number;
  /** Whether the board currently has a tab; a closed board is still listed. */
  open: boolean;
  /** Cards placed on this board right now. */
  cardCount: number;
  /** Offered in the Boards tab's Templates group; using one copies the board. */
  template?: boolean;
  /**
   * No portal names this board and it is not the entry board, so the list is the
   * only way in. Computed from the snapshot with the list, never stored.
   */
}

/** The facet a board row filters under; not a card type, so nothing may create it. */
export const BOARD_TYPE_FACET = "board";

/** A row is a board rather than a card. */
export function isBoardItem(item: { kind?: "card" | "board" | undefined }): boolean {
  return item.kind === "board";
}

/**
 * A board item seen as a board row.
 *
 * The row needs two things a card item has no field for — how many cards are on
 * the board, and whether it is the one on screen — so the adapter is here rather
 * than in the row renderer, and the row keeps a shape of its own.
 */
export function toBoardRow(
  item: LibraryItem & { cardCount?: number },
  activeBoardId: string | null,
): LibraryBoard {
  return {
    id: item.id,
    title: item.title,
    open: item.id === activeBoardId,
    cardCount: item.cardCount ?? 0,
  };
}

/**
 * What a drawer row is.
 *
 * One shape for both kinds: a board row is a `LibraryItem` with `kind: "board"`,
 * so a row never has to ask which of two payloads it was handed.
 */
export type LibraryEntry = { kind: "card" | "board"; card: LibraryItem };

export interface LibraryDrawerProps {
  open: boolean;
  tab: LibraryTab;
  /** `Partial` so a caller (or a story) that predates a tab still type-checks. */
  counts: Partial<Record<LibraryTab, number>>;
  inbox: LibraryItem[];
  cards: LibraryItem[];
  trash: LibraryItem[];
  media?: WorkspaceMediaItem[];
  trashedMedia?: WorkspaceMediaItem[];
  onTrashMedia?: (id: string) => void;
  onRestoreMedia?: (id: string) => void;
  onDeleteMediaForever?: (id: string) => void;
  /** Places a media item as a card of its own, so it can live on a board. */
  onPlaceMediaAsCard?: (media: WorkspaceMediaItem) => void;
  /**
   * Every board as a library row. Boards are already inside `cards`/`inbox`;
   * this is the same set, for the places that need a board by id.
   */
  boards?: Array<LibraryItem & { cardCount?: number }>;
  /** A new board, opened. Absent when this session may not create boards. */
  onCreateBoard?: (() => void) | undefined;
  /**
   * The same "new card" verbs the dock offers, so the library can start a card as
   * well as a board. Each row is absent when its handler is.
   */
  onCreateCard?: ((typeId: string) => void) | undefined;
  onCreateSketch?: (() => void) | undefined;
  onCreateSection?: (() => void) | undefined;
  onCreatePortal?: ((targetBoardId: string) => void) | undefined;
  /** Switches to the board. */
  onOpenBoard?: (boardId: string) => void;
  /** Creates a portal card to the board on the active board; the row stays put. */
  onPlaceBoard?: (boardId: string) => void;
  /** The same portal, dropped where the reader let go. */
  /** Removes this board's placements only; a card on another board stays there. */
  onUnplaceBoardCards?: (boardId: string) => void;
  /** Asks once, here: unplace the cards or trash them with the board. */
  onDeleteBoard?: (boardId: string, cards: "keep" | "trash") => void;
  /** Pans to a card on the active board; false when it is not on this one. */
  onLocateCard?: (cardId: string) => boolean;
  /** Pans to this board's portal on the active board, else opens the board. */
  onLocateBoard?: (boardId: string) => boolean;
  /**
   * Copies a template into a new board and opens it. Absent when this session
   * may not create boards, which also hides the Templates group.
   */
  onUseBoardTemplate?: (templateId: string) => void;
  /** Generates a built-in starter as a new board and opens it. */
  onUseStarter?: (starterId: string) => void;
  /** Marks or unmarks a board as a template. Absent leaves the rows alone. */
  onSetBoardTemplate?: (boardId: string, template: boolean) => void;
  /** Opens the type editor from the facet row. Absent where schema is read-only. */
  onManageTypes?: (() => void) | undefined;
  /** Built-in shapes offered under the workspace's own templates. */
  starters?: readonly BoardStarter[];
  onTab: (tab: LibraryTab) => void;
  onClose: () => void;
  onPlace: (cardId: string) => void;
  /**
   * Whether this session may write layout. A viewer still lifts a row and still
   * publishes the ghost — seeing the gesture is how they know something is
   * happening — but releasing over the canvas places nothing.
   */
  canPlace?: boolean;
  onCreateInInbox: () => void;
  onTrash: (cardId: string) => void;
  onRestore: (cardId: string) => void;
  onDeleteForever: (cardId: string) => void;
  onEmptyTrash: () => void;
  onGoToBoard: (boardId: string) => void;
  /** Pointer drop over the canvas, in client coordinates: one card or a picked stack. */
  onDropAt: (cardIds: readonly string[], point: { x: number; y: number }) => void;
  /** Put the picked rows in the reader's hand, to place one press at a time. */
  onPlaceCards: (cardIds: readonly string[]) => void;
  types: CardType[];
  tags: Tag[];
  typeFilter: string[];
  tagFilter: string[];
  onToggleType: (id: string) => void;
  onToggleTag: (id: string) => void;
  onClearFilters: () => void;
  /** Board that scopes the Cards tab, and the name the scope control shows. */
  activeBoardId: string | null;
  activeBoardName: string | null;
  scope: LibraryScope;
  onScope: (scope: LibraryScope) => void;
  /** The drawer is taking the whole window; the toggle lives in its header. */
  full: boolean;
  onFull: (full: boolean) => void;
  sectionFilter: string[];
  onToggleSection: (id: string) => void;
  /** Sections of the active board in outline order. */
  sectionOrder: SectionOrderEntry[];
  groupBySection: boolean;
  onToggleGroup: () => void;
  /** Opens a card in the inspector; rows never expand in place. */
  onOpenCard: (cardId: string) => void;
  /**
   * Run the selection in one shape: the verb *is* the mode (ADR-0063), so a caller
   * sets the mode and starts the run in one go.
   */
  onRunCards?: ((cardIds: readonly string[], mode: CanvasMode) => void) | undefined;
  /** True while a run is placing, so a row's Place verb joins it instead of starting one. */
  runActive?: boolean;
  /** Add cards to the live run: the picker loop's other half. */
  onQueueCards?: ((cardIds: readonly string[]) => void) | undefined;
  /**
   * Start a picker loop: place one card and stay live, so every later pick joins
   * the same sequence.
   */
  onRunLoop?: ((cardIds: readonly string[]) => void) | undefined;
  /** Trash, restore, purge and empty the trash; owner and workspace editor. */
  canManageTrash?: boolean;
  /** Search source; defaults to the live document in the canvas store. */
  workspace?: WorkspaceDocument | null;
  /** Seeds the query box. Stories and tests only. */
  initialQuery?: string;
}
