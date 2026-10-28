import type { CardType, PropertyValue, Tag, WorkspaceDocument } from "@suite/graph";
import type { CanvasMode } from "../canvas/links/linkGesture";
import type { LibraryScope, LibraryTab } from "../store/useUiStore";
import type { SectionOrderEntry } from "./libraryFilters";
import type { BoardStarter } from "./TemplateGallery";

export interface LibraryItem {
  id: string;
  title: string;
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

/** What a drawer row can be. Boards are global: they never leave this list. */
export type LibraryEntry =
  | { kind: "card"; card: LibraryItem }
  | { kind: "board"; board: LibraryBoard };

export interface LibraryDrawerProps {
  open: boolean;
  tab: LibraryTab;
  /** `Partial` so a caller (or a story) that predates a tab still type-checks. */
  counts: Partial<Record<LibraryTab, number>>;
  inbox: LibraryItem[];
  cards: LibraryItem[];
  trash: LibraryItem[];
  /** Every board in the workspace, open or closed. */
  boards?: LibraryBoard[];
  /** A new board, opened. Absent when this session may not create boards. */
  onCreateBoard?: (() => void) | undefined;
  /** Switches to the board. */
  onOpenBoard?: (boardId: string) => void;
  /** Creates a portal card to the board on the active board; the row stays put. */
  onPlaceBoard?: (boardId: string) => void;
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
  /** Pointer drop over the canvas, in client coordinates. */
  onDropAt: (cardId: string, point: { x: number; y: number }) => void;
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
