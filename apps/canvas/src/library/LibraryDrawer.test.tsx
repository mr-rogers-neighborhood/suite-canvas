import type { WorkspaceDocument } from "@suite/graph";
import { WorkspaceDocument as Document, PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LoroMap, LoroText } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dock } from "../chrome/Dock";
import { useUiStore } from "../store/useUiStore";
import { LibraryDrawer, type LibraryDrawerProps, type LibraryItem } from "./LibraryDrawer";
import { templateCopyName } from "./TemplateGallery";

function addNode(parent: LoroMap, name: string): LoroMap {
  const children = parent.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", name);
  return node;
}

function addText(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const value = children.insertContainer(children.length, new LoroText());
  value.insert(0, text);
}

interface Fixture {
  workspace: WorkspaceDocument;
  items: LibraryItem[];
}

function fixture(): Fixture {
  const workspace = new Document();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();

  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  addText(workspace.getTitle("c1"), "Mastering the timeline");
  addText(addNode(workspace.getContent("c1"), "paragraph"), "Pacing notes for the second pass.");

  workspace.createCard({ id: "c2", boardId: board.id, position: { x: 320, y: 0 } });
  addText(workspace.getTitle("c2"), "Interview notes");
  addText(addNode(workspace.getContent("c2"), "paragraph"), "The editor mentioned colour grading.");

  workspace.doc.commit({ origin: "test" });

  const items: LibraryItem[] = ["c1", "c2"].map((id) => ({
    id,
    title: workspace.displayTitle(id),
    boards: [{ id: board.id, name: board.name }],
    typeIds: workspace.getCard(id)?.typeIds ?? [],
    tagIds: [],
    sectionIds: [],
    properties: {},
  }));

  return { workspace, items };
}

interface Rendered {
  props: LibraryDrawerProps;
  onOpenCard: ReturnType<typeof vi.fn>;
  /** Re-renders the same component tree, so hook state and caches survive. */
  rerender: (next: Partial<LibraryDrawerProps>) => void;
}

function renderDrawer(
  workspace: WorkspaceDocument,
  items: LibraryItem[],
  overrides: Partial<LibraryDrawerProps> = {},
): Rendered {
  const onOpenCard = vi.fn();
  const props: LibraryDrawerProps = {
    open: true,
    tab: "cards",
    counts: { inbox: 0, cards: items.length, trash: 0 },
    inbox: [],
    cards: items,
    trash: [],
    onTab: () => {},
    onClose: () => {},
    onPlace: () => {},
    onCreateInInbox: () => {},
    onTrash: () => {},
    onRestore: () => {},
    onDeleteForever: () => {},
    onEmptyTrash: () => {},
    onGoToBoard: () => {},
    onDropAt: () => {},
    types: [],
    tags: [],
    typeFilter: [],
    tagFilter: [],
    onToggleType: () => {},
    onToggleTag: () => {},
    onClearFilters: () => {},
    activeBoardId: null,
    activeBoardName: null,
    scope: "all",
    onScope: () => {},
    full: false,
    onFull: () => {},
    sectionFilter: [],
    onToggleSection: () => {},
    sectionOrder: [],
    groupBySection: false,
    onToggleGroup: () => {},
    onOpenCard,
    workspace,
    ...overrides,
  };
  const view = render(<LibraryDrawer {...props} />);
  return {
    props,
    onOpenCard,
    rerender: (next: Partial<LibraryDrawerProps>) =>
      view.rerender(<LibraryDrawer {...props} {...next} />),
  };
}

function type(text: string): void {
  fireEvent.change(screen.getByTestId("library-search"), { target: { value: text } });
}

beforeEach(() => {
  useUiStore.setState({ libraryOpen: false, libraryTab: "inbox" });
});

/**
 * Runs one action from a row's ⋯ menu. The menu is the same context menu the
 * canvas uses, portalled to the body, so its items are queried from `screen`
 * rather than from the row.
 */
function rowAction(id: string, action: string) {
  fireEvent.click(screen.getByTestId(`library-row-menu-${id}`));
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

/** The actions a row offers, without running any of them. */
function rowActions(id: string): string[] {
  fireEvent.click(screen.getByTestId(`library-row-menu-${id}`));
  const labels = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
  fireEvent.click(screen.getByLabelText("Close context menu"));
  return labels;
}

describe("LibraryDrawer search", () => {
  it("should filter the list while a query is present", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    expect(screen.getByTestId("library-item-c1")).toBeInTheDocument();
    expect(screen.getByTestId("library-item-c2")).toBeInTheDocument();

    type("grading");

    expect(screen.queryByTestId("library-item-c1")).not.toBeInTheDocument();
    expect(screen.getByTestId("library-item-c2")).toBeInTheDocument();
  });

  /**
   * Regression: the index is built on the first query and patched afterwards.
   * A card created while no search was active used to stay invisible until a
   * reload, because the patch stream never carried it into a not-yet-built
   * index. The index now re-checks how many cards it covers.
   */
  it("should find a card created after the index was built", () => {
    const { workspace, items } = fixture();
    const view = renderDrawer(workspace, items);

    // Warm the index with a query that matches, then clear it.
    type("grading");
    expect(screen.getByTestId("library-item-c2")).toBeInTheDocument();
    type("");
    expect(screen.getByTestId("library-item-c1")).toBeInTheDocument();

    // A card added to the live document after that first build.
    const boardId = workspace.listBoards()[0]?.id ?? "";
    workspace.createCard({ id: "c3", boardId, position: { x: 640, y: 0 } });
    addText(workspace.getTitle("c3"), "Freshly written retrospective");
    workspace.doc.commit({ origin: "test" });

    // The drawer's item list comes from the snapshot in the app; here the test
    // re-renders the same tree with the new item, so the assertion is about the
    // index rather than about a fresh mount.
    type("grading");
    view.rerender({
      cards: [
        ...items,
        {
          id: "c3",
          title: "Freshly written retrospective",
          boards: [{ id: boardId, name: "Board" }],
          typeIds: [],
          tagIds: [],
          sectionIds: [],
          properties: {},
        },
      ],
    });

    type("retrospective");
    expect(screen.getByTestId("library-item-c3")).toBeInTheDocument();
  });

  it("should rank title matches above body matches", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    // "notes" is a body word on c1 and the first title word on c2.
    type("notes");

    const rows = screen.getAllByRole("listitem").map((row) => row.getAttribute("data-row-id"));
    expect(rows).toEqual(["c2", "c1"]);
  });

  it("should highlight the matched text in the title and the snippet", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    type("timeline");
    const title = screen.getByTestId("library-title-c1");
    expect(title.querySelector("mark")?.textContent).toBe("timeline");

    type("grading");
    const snippet = screen.getByTestId("library-snippet-c2");
    expect(snippet.querySelector("mark")?.textContent).toBe("grading");
  });

  it("should restore the facet list when the query is cleared", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    type("grading");
    expect(screen.queryByTestId("library-item-c1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-search-clear"));

    expect(screen.getByTestId("library-search")).toHaveValue("");
    expect(screen.getByTestId("library-item-c1")).toBeInTheDocument();
    expect(screen.getByTestId("library-item-c2")).toBeInTheDocument();
  });

  it("should say so when nothing matches", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    type("nothing matches this");

    expect(screen.getByTestId("library-search-empty")).toHaveTextContent(
      "No cards match \u201cnothing matches this\u201d.",
    );
    expect(screen.queryByTestId("library-item-c1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("library-item-c2")).not.toBeInTheDocument();
  });

  it("should keep facets narrowing the ranked hits", () => {
    const { workspace, items } = fixture();
    // Both cards index "notes", but the active type facet matches neither.
    renderDrawer(workspace, items, { typeFilter: ["other-type"] });

    type("notes");

    expect(screen.queryByTestId("library-item-c1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("library-item-c2")).not.toBeInTheDocument();
    expect(screen.getByTestId("library-search-empty")).toBeInTheDocument();
  });

  it("should move through results with the arrow keys and open the inspector", () => {
    const { workspace, items } = fixture();
    const { onOpenCard } = renderDrawer(workspace, items);

    type("notes");
    const input = screen.getByTestId("library-search");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpenCard).toHaveBeenCalledWith("c1");
  });

  it("should pick up a body edit when the index refreshes", async () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    type("zebra");
    expect(screen.getByTestId("library-search-empty")).toBeInTheDocument();

    addText(addNode(workspace.getContent("c1"), "paragraph"), "A zebra crosses the frame.");
    workspace.doc.commit({ origin: "test" });

    await waitFor(() => expect(screen.getByTestId("library-item-c1")).toBeInTheDocument());
  });

  it("should clear the query on Escape before closing", () => {
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderDrawer(workspace, items, { onClose });

    type("grading");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("library-search")).toHaveValue("");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("LibraryDrawer dismissal", () => {
  afterEach(() => {
    document.querySelector('[data-testid="canvas-board"]')?.remove();
  });

  /**
   * A stand-in for the board, since the drawer dismisses on a press anywhere inside
   * it. Returns the child the press will land on.
   */
  function board(child: "pane" | "card"): HTMLElement {
    const host = document.createElement("div");
    host.setAttribute("data-testid", "canvas-board");
    const target = document.createElement("div");
    target.className = child === "pane" ? "react-flow__pane" : "node-card";
    host.append(target);
    document.body.append(host);
    return target;
  }

  it("should close when a press lands on the board's pane, and the pane keeps none of it", () => {
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderDrawer(workspace, items, { onClose });

    // Default prevented: the press dismisses the drawer and places nothing behind it.
    const kept = fireEvent.pointerDown(board("pane"));

    expect(kept).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should close on a card too, without swallowing the card's press", () => {
    // A card is the board as much as the empty space is; only the *pane* has nothing
    // to do with the press, so only the pane loses it.
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderDrawer(workspace, items, { onClose });

    const kept = fireEvent.pointerDown(board("card"));

    expect(kept).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should keep its own presses", () => {
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderDrawer(workspace, items, { onClose });

    fireEvent.pointerDown(screen.getByTestId("library-search"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("should leave the chrome alone, because the canvas is what is outside it", () => {
    // The app bar, the tab strip and the dock are deliberate targets: pressing one is
    // not a way of putting the drawer away, and the drawer's own controls are.
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderDrawer(workspace, items, { onClose });
    const tab = document.createElement("button");
    document.body.append(tab);

    const kept = fireEvent.pointerDown(tab);

    expect(kept).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    tab.remove();
  });

  it("should offer a close button that reads as its own control", () => {
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderDrawer(workspace, items, { onClose });

    const close = screen.getByTestId("library-close");
    expect(close).toHaveAccessibleName("Close library");
    expect(close).toHaveClass("library-close");

    fireEvent.click(close);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Library shortcut", () => {
  function renderShell(
    workspace: WorkspaceDocument,
    items: LibraryItem[],
    onClose: () => void = () => {},
  ): void {
    function Shell() {
      const open = useUiStore((state) => state.libraryOpen);
      const tab = useUiStore((state) => state.libraryTab);
      return (
        <>
          <Dock
            inboxCount={0}
            libraryOpen={open}
            types={[]}
            onToggleLibrary={() => useUiStore.getState().setLibraryOpen(!open)}
            onCreateCard={() => {}}
            onManageTypes={() => {}}
          />
          <LibraryDrawer
            open={open}
            tab={tab}
            counts={{ inbox: 0, cards: items.length, trash: 0 }}
            inbox={[]}
            cards={items}
            trash={[]}
            onTab={() => {}}
            onClose={onClose}
            onPlace={() => {}}
            onCreateInInbox={() => {}}
            onTrash={() => {}}
            onRestore={() => {}}
            onDeleteForever={() => {}}
            onEmptyTrash={() => {}}
            onGoToBoard={() => {}}
            onDropAt={() => {}}
            types={[]}
            tags={[]}
            typeFilter={[]}
            tagFilter={[]}
            onToggleType={() => {}}
            onToggleTag={() => {}}
            onClearFilters={() => {}}
            activeBoardId={null}
            activeBoardName={null}
            scope="all"
            onScope={() => {}}
            full={false}
            onFull={() => {}}
            sectionFilter={[]}
            onToggleSection={() => {}}
            sectionOrder={[]}
            groupBySection={false}
            onToggleGroup={() => {}}
            onOpenCard={() => {}}
            workspace={workspace}
          />
        </>
      );
    }
    render(<Shell />);
  }

  it("should open the library on Cards and focus the search box from Cmd+Shift+K", () => {
    const { workspace, items } = fixture();
    renderShell(workspace, items);

    expect(screen.queryByTestId("library-search")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true, shiftKey: true });

    expect(useUiStore.getState().libraryOpen).toBe(true);
    expect(useUiStore.getState().libraryTab).toBe("cards");
    expect(screen.getByTestId("library-search")).toHaveFocus();
  });

  it("should open the command palette from Cmd+K instead of the library", () => {
    const { workspace, items } = fixture();
    renderShell(workspace, items);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(useUiStore.getState().paletteOpen).toBe(true);
    expect(useUiStore.getState().libraryOpen).toBe(false);
  });

  it("should leave the dock trigger to toggle rather than dismiss", () => {
    // The trigger is the one press outside the drawer that is about the drawer: a
    // dismissal followed by its own toggle would reopen what it just closed.
    const { workspace, items } = fixture();
    const onClose = vi.fn();
    renderShell(workspace, items, onClose);
    act(() => {
      useUiStore.getState().setLibraryOpen(true);
    });

    fireEvent.pointerDown(screen.getByTestId("dock-library"));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("LibraryDrawer boards", () => {
  interface BoardFixture {
    workspace: WorkspaceDocument;
    first: { id: string; name: string };
    second: { id: string; name: string };
    /** Boards as the rows the list now holds: items typed `board`. */
    entries: () => LibraryItem[];
  }

  /** Two named boards and a card on the first one. */
  function boardFixture(): BoardFixture {
    const workspace = new Document();
    workspace.ensureDefaultTypes();
    const first = workspace.ensureBoard();
    workspace.renameBoard(first.id, "Research");
    const second = workspace.createBoard({ name: "Drafts" });
    workspace.createCard({ id: "c1", boardId: first.id, position: { x: 0, y: 0 } });
    workspace.doc.commit({ origin: "test" });

    return {
      workspace,
      first: { id: first.id, name: "Research" },
      second: { id: second.id, name: "Drafts" },
      entries: () =>
        workspace.listBoards().map((board) => ({
          id: board.id,
          title: board.name,
          kind: "board" as const,
          boards: [],
          typeIds: ["board"],
          tagIds: [],
          sectionIds: [],
          properties: {},
          cardCount: workspace.listBoardCards(board.id).length,
        })),
    };
  }

  const rowIds = (): Array<string | null> =>
    screen.getAllByRole("listitem").map((row) => row.getAttribute("data-row-id"));

  it("should list every board, open or closed", () => {
    const { workspace, first, second, entries } = boardFixture();
    renderDrawer(workspace, entries(), {
      tab: "cards",
      boards: entries(),
      activeBoardId: second.id,
    });

    expect(screen.getByTestId(`library-title-${first.id}`)).toHaveTextContent("Research");
    expect(screen.getByTestId(`library-title-${second.id}`)).toHaveTextContent("Drafts");
    expect(screen.getByTestId(`library-board-state-${first.id}`)).toHaveTextContent("Closed");
    expect(screen.getByTestId(`library-board-state-${second.id}`)).toHaveTextContent("Open");
  });

  /** The drawer's `cards` prop is the workspace's live cards, as the shell builds it. */
  it("should place a board without moving or removing its row", () => {
    const { workspace, first, second, entries } = boardFixture();
    const view = renderDrawer(workspace, [], {
      tab: "cards",
      cards: entries(),
      boards: entries(),
      activeBoardId: first.id,
      onPlaceBoard: (boardId) => {
        workspace.createPortalCard({
          boardId: first.id,
          targetBoardId: boardId,
          position: { x: 0, y: 0 },
        });
      },
    });

    const before = rowIds();
    rowAction(second.id, "Place on board");
    view.rerender({ boards: entries() });

    // A portal to the board exists on the active board...
    const portal = workspace
      .listBoardCards(first.id)
      .find((card) => card.properties[PORTAL_BOARD_FIELD_ID] === second.id);
    expect(portal).toBeDefined();
    // ...and the board it points at keeps its place in the section.
    expect(rowIds()).toEqual(before);
    expect(screen.getByTestId(`library-title-${second.id}`)).toBeInTheDocument();
  });

  it("should unplace only this board's placements", () => {
    const { workspace, first, second, entries } = boardFixture();
    // The same card also lives on the second board.
    workspace.placeCard(second.id, "c1", { x: 40, y: 40 });

    renderDrawer(workspace, [], {
      tab: "cards",
      cards: entries(),
      boards: entries(),
      onUnplaceBoardCards: (boardId) => {
        for (const card of workspace.listBoardCards(boardId)) {
          workspace.unplaceCard(boardId, card.id);
        }
      },
    });

    rowAction(first.id, "Unplace its cards");

    expect(workspace.listCardPlacements("c1").map((placement) => placement.boardId)).toEqual([
      second.id,
    ]);
    expect(workspace.getCard("c1")?.deletedAt ?? null).toBeNull();
  });

  it("should ask once and offer unplace or trash", () => {
    const { workspace, first, entries } = boardFixture();
    const onDeleteBoard = vi.fn();
    renderDrawer(workspace, entries(), {
      tab: "cards",
      cards: entries(),
      boards: entries(),
      onDeleteBoard,
    });

    rowAction(first.id, "Delete board\u2026");

    expect(screen.getByTestId("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete board?")).toBeInTheDocument();
    expect(onDeleteBoard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Unplace cards" }));
    expect(onDeleteBoard).toHaveBeenCalledWith(first.id, "keep");
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("should trash the board's cards when asked to", () => {
    const { workspace, first, entries } = boardFixture();
    const onDeleteBoard = vi.fn();
    renderDrawer(workspace, entries(), {
      tab: "cards",
      cards: entries(),
      boards: entries(),
      onDeleteBoard,
    });

    rowAction(first.id, "Delete board\u2026");
    fireEvent.click(screen.getByRole("button", { name: "Trash cards" }));

    expect(onDeleteBoard).toHaveBeenCalledWith(first.id, "trash");
  });

  it("should offer Place and no Locate for a card that is not on the active board", () => {
    const { workspace, items } = fixture();
    const onLocateCard = vi.fn(() => false);
    const onPlace = vi.fn();
    renderDrawer(workspace, items, {
      tab: "cards",
      activeBoardId: "another-board",
      onLocateCard,
      onPlace,
    });

    expect(rowActions("c1")).toContain("Place on board");
    expect(rowActions("c1")).not.toContain("Locate");
    rowAction("c1", "Place on board");

    expect(onPlace).toHaveBeenCalledWith("c1");
    expect(onLocateCard).not.toHaveBeenCalled();
  });

  /**
   * The inbox is the list of cards with no placement at all, so Locate there
   * could only ever say "not on this board".
   */
  it("should offer Place and no Locate for every inbox card", () => {
    const { workspace, items } = fixture();
    const unplaced = items.map((item) => ({ ...item, boards: [] }));
    const onPlace = vi.fn();
    renderDrawer(workspace, [], {
      tab: "inbox",
      inbox: unplaced,
      counts: { inbox: unplaced.length, cards: 0, trash: 0 },
      activeBoardId: "some-board",
      onPlace,
    });

    expect(rowActions("c1")).toContain("Place on board");
    expect(rowActions("c1")).not.toContain("Locate");
    rowAction("c1", "Place on board");

    expect(onPlace).toHaveBeenCalledWith("c1");
  });

  it("should pan to a card that is on the active board when locating it", () => {
    const { workspace, items } = fixture();
    const boardId = workspace.listBoards()[0]?.id ?? "";
    const onLocateCard = vi.fn(() => true);
    const onPlace = vi.fn();
    renderDrawer(workspace, items, {
      tab: "cards",
      activeBoardId: boardId,
      onLocateCard,
      onPlace,
    });

    expect(rowActions("c1")).toContain("Locate");
    expect(rowActions("c1")).not.toContain("Place on board");
    rowAction("c1", "Locate");

    expect(onLocateCard).toHaveBeenCalledWith("c1");
    expect(onPlace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("library-locate-miss")).not.toBeInTheDocument();
  });

  /**
   * The library is the only place a board is deleted, so its two choices are
   * pinned to the document behaviour they promise. The trash scope is this
   * board's own cards — never a card that still lives somewhere else.
   */
  it("should trash only the cards that were on the deleted board", () => {
    const { workspace, first, second } = boardFixture();
    const shared = workspace.createCard({ boardId: second.id });
    workspace.placeCard(first.id, shared.id, { x: 10, y: 10 });
    const elsewhere = workspace.createCard({ boardId: second.id });

    workspace.deleteBoard(first.id, { cards: "trash" });

    expect(typeof workspace.getCard("c1")?.deletedAt).toBe("number");
    // Shared with another board by placement: it stays where it is.
    expect(workspace.getCard(shared.id)?.deletedAt ?? null).toBeNull();
    expect(workspace.getCard(elsewhere.id)?.deletedAt ?? null).toBeNull();
  });

  it("should keep every card when the delete asks to unplace them", () => {
    const { workspace, first } = boardFixture();

    workspace.deleteBoard(first.id, { cards: "keep" });

    expect(workspace.getCard("c1")?.deletedAt ?? null).toBeNull();
    expect(workspace.listCardPlacements("c1")).toHaveLength(0);
  });
});

describe("LibraryDrawer board blueprints", () => {
  interface TemplateFixture {
    workspace: WorkspaceDocument;
    template: { id: string; name: string };
    other: { id: string; name: string };
    entries: () => LibraryItem[];
  }

  /**
   * A workspace with one board worth keeping ("Research": a section and two
   * cards) and one that is not ("Drafts"). The drawer never reads the document
   * itself, so every handler here is the one `App` wires.
   */
  function templateFixture(): TemplateFixture {
    const workspace = new Document();
    workspace.ensureDefaultTypes();
    const template = workspace.ensureBoard();
    workspace.renameBoard(template.id, "Research");
    workspace.createSection({
      boardId: template.id,
      title: "Sources",
      x: 0,
      y: 0,
      width: 360,
      height: 400,
    });
    workspace.createCard({ id: "c1", boardId: template.id, position: { x: 40, y: 80 } });
    addText(workspace.getTitle("c1"), "Reading list");
    workspace.createCard({ id: "c2", boardId: template.id, position: { x: 40, y: 320 } });
    addText(workspace.getTitle("c2"), "People to talk to");
    const other = workspace.createBoard({ name: "Drafts" });
    workspace.doc.commit({ origin: "test" });

    return {
      workspace,
      template: { id: template.id, name: "Research" },
      other: { id: other.id, name: "Drafts" },
      entries: () =>
        workspace.listBoards().map((board) => ({
          id: board.id,
          title: board.name,
          kind: "board" as const,
          boards: [],
          typeIds: ["board"],
          tagIds: [],
          sectionIds: [],
          properties: {},
          cardCount: workspace.listBoardCards(board.id).length,
          template: board.template === true,
        })),
    };
  }

  /** What `App` does when a template is used, minus the drawer close. */
  const useTemplate = (workspace: WorkspaceDocument) => {
    return (templateId: string) => {
      const source = workspace.getBoard(templateId);
      if (!source) return;
      const name = templateCopyName(
        source.name,
        workspace.listBoards().map((board) => board.name),
      );
      const board = workspace.duplicateBoard(templateId, { name });
      if (board) useUiStore.getState().activateBoard(board.id);
    };
  };

  it.skip("should save a board as a blueprint and offer it in the Blueprints group", () => {
    const { workspace, template, entries } = templateFixture();
    const view = renderDrawer(workspace, [], {
      tab: "cards",
      cards: entries(),
      boards: entries(),
      onSetBoardTemplate: (boardId, isTemplate) => workspace.setBoardTemplate(boardId, isTemplate),
      // Saving and starting are separate capabilities; this test only exercises
      // saving, but a real drawer has both (App wires them together).
      onUseBoardTemplate: () => {},
    });

    // Nothing is a template yet, so the group is not there to be read.
    expect(screen.queryByTestId("library-templates")).not.toBeInTheDocument();

    rowAction(template.id, "Save as blueprint");
    expect(workspace.getBoard(template.id)?.template).toBe(true);

    view.rerender({ boards: entries() });

    expect(screen.getByTestId("library-templates")).toBeInTheDocument();
    expect(screen.getByTestId(`library-template-title-${template.id}`)).toHaveTextContent(
      "Research",
    );
    // The row says what it acts on, so a keyboard or screen-reader user knows.
    expect(screen.getByRole("button", { name: "Use blueprint Research" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit blueprint Research" })).toBeInTheDocument();

    rowAction(template.id, "Stop being a blueprint");
    expect(workspace.getBoard(template.id)?.template).toBeUndefined();
  });

  it.skip("should copy a template into a new board and activate it", () => {
    const { workspace, template, entries } = templateFixture();
    useUiStore.setState({ activeBoardId: null });
    workspace.setBoardTemplate(template.id, true);

    renderDrawer(workspace, [], {
      tab: "cards",
      cards: entries(),
      boards: entries(),
      onUseBoardTemplate: useTemplate(workspace),
    });

    fireEvent.click(screen.getByTestId(`library-template-use-${template.id}`));

    const copy = workspace.listBoards().find((board) => board.name === "Research 2");
    expect(copy).toBeDefined();
    if (!copy) return;
    // Everything drawn on the template came along...
    expect(workspace.listSections(copy.id).map((section) => section.title)).toEqual(["Sources"]);
    expect(
      workspace.listBoardCards(copy.id).map((card) => workspace.displayTitle(card.id)),
    ).toEqual(["Reading list", "People to talk to"]);
    // ...as copies: the source board is untouched.
    expect(workspace.listBoardCards(template.id)).toHaveLength(2);
    expect(workspace.getBoard(template.id)?.template).toBe(true);
    // The copy is not itself a template, and it is the board in front now.
    expect(copy.template ?? false).toBe(false);
    expect(useUiStore.getState().activeBoardId).toBe(copy.id);
  });

  it("should number a copy past a name that is already taken", () => {
    expect(templateCopyName("Research", ["Research"])).toBe("Research 2");
    expect(templateCopyName("Research", ["Research", "Research 2"])).toBe("Research 3");
    expect(templateCopyName("Research", ["Research", "Research 2", "Research 3"])).toBe(
      "Research 4",
    );
  });
});

describe("LibraryDrawer tag lens", () => {
  function withSectionTag() {
    const { workspace, items } = fixture();
    const board = workspace.listBoards()[0];
    if (!board) throw new Error("fixture has no board");
    const section = workspace.createSection({
      boardId: board.id,
      title: "Act one",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    const tag = workspace.createTag({ name: "research" });
    workspace.addSectionTag(section.id, tag.id);
    return { workspace, items, section, tag };
  }

  it("counts a section's tag for the cards inside it, and filters by it", () => {
    const { workspace, items, section, tag } = withSectionTag();
    const onToggleTag = vi.fn();
    const scoped = items.map((item) =>
      item.id === "c1" ? { ...item, sectionIds: [section.id] } : item,
    );

    const rendered = renderDrawer(workspace, scoped, {
      tags: workspace.listTags(),
      onToggleTag,
    });

    const facet = screen.getByTestId(`facet-tag-${tag.id}`);
    expect(facet).toHaveTextContent("1");
    fireEvent.click(facet);
    expect(onToggleTag).toHaveBeenCalledWith(tag.id);

    // What an applied lens does: the same tag arrives as the filter value.
    rendered.rerender({ tagFilter: [tag.id] });

    expect(screen.getByTestId("library-item-c1")).toBeInTheDocument();
    expect(screen.queryByTestId("library-item-c2")).toBeNull();
  });

  it("does not count a section tag for a card outside the section", () => {
    const { workspace, items, tag } = withSectionTag();

    renderDrawer(workspace, items, { tags: workspace.listTags() });

    // Membership is geometry: no card names the section, so the tag stays a
    // label on the section rather than a membership claim about cards.
    expect(screen.getByTestId(`facet-tag-${tag.id}`)).toHaveTextContent("0");
  });

  it("counts a card once when the card and its section carry the same tag", () => {
    const { workspace, items, section, tag } = withSectionTag();
    const scoped = items.map((item) =>
      item.id === "c1" ? { ...item, sectionIds: [section.id], tagIds: [tag.id] } : item,
    );

    renderDrawer(workspace, scoped, { tags: workspace.listTags() });

    expect(screen.getByTestId(`facet-tag-${tag.id}`)).toHaveTextContent("1");
  });
});

describe("row actions", () => {
  it("keeps every action behind one menu so the title has the row", () => {
    const { workspace, items } = fixture();
    const boardId = workspace.listBoards()[0]?.id ?? "";
    renderDrawer(workspace, items, { tab: "cards", activeBoardId: boardId });

    // The row is a title, its metadata, its own open button (the keyboard path)
    // and one menu button — the actions are not buttons in the row any more.
    const row = screen.getByTestId("library-item-c1");
    expect(within(row).getAllByRole("button")).toHaveLength(2);
    expect(within(row).getByTestId("library-row-menu-c1")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: /^Mastering the timeline/ }),
    ).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Locate" })).toBeNull();
  });

  it("opens the same menu from the row's right-click", () => {
    const { workspace, items } = fixture();
    const boardId = workspace.listBoards()[0]?.id ?? "";
    renderDrawer(workspace, items, { tab: "cards", activeBoardId: boardId });

    fireEvent.contextMenu(screen.getByTestId("library-item-c1"), { clientX: 40, clientY: 40 });

    expect(screen.getByRole("menuitem", { name: "Open details" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Locate" })).toBeInTheDocument();
  });

  it("offers a trash row Restore and Delete forever, and nothing else", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items, {
      tab: "trash",
      trash: items,
      counts: { inbox: 0, cards: 0, trash: 2 },
    });

    expect(rowActions("c1")).toEqual(["Restore", "Delete forever"]);
  });

  it("offers no menu at all to a session that may not manage trash", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items, { tab: "trash", trash: items, canManageTrash: false });

    fireEvent.click(screen.getByTestId("library-row-menu-c1"));

    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("opens a card's details, which a row could only do by clicking it", () => {
    const { workspace, items } = fixture();
    const onOpenCard = vi.fn();
    renderDrawer(workspace, items, { tab: "cards", onOpenCard });

    rowAction("c1", "Open details");

    expect(onOpenCard).toHaveBeenCalledWith("c1");
  });

  it("reads every action a board row can take", () => {
    const workspace = new Document();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const entry = {
      id: board.id,
      title: board.name,
      kind: "board" as const,
      boards: [],
      typeIds: ["board"],
      tagIds: [],
      sectionIds: [],
      properties: {},
      cardCount: 0,
    };
    renderDrawer(workspace, [entry], { tab: "cards", boards: [entry] });

    expect(rowActions(board.id)).toEqual([
      "Open",
      "Place on board",
      "Locate",
      "Unplace its cards",
      "Delete board\u2026",
    ]);
  });
});

describe("expanded library", () => {
  it("asks the host to expand, and reports the state it was given", () => {
    const { workspace, items } = fixture();
    const onFull = vi.fn();
    const view = renderDrawer(workspace, items, { tab: "cards", onFull });

    const toggle = screen.getByTestId("library-expand");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(onFull).toHaveBeenCalledWith(true);

    view.rerender({ full: true });
    expect(screen.getByTestId("library-drawer")).toHaveAttribute("data-full", "true");
    expect(screen.getByTestId("library-expand")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("library-expand"));
    expect(onFull).toHaveBeenLastCalledWith(false);
  });
});

/**
 * Rows were pointer-only: `onPointerDown` on a `div` meant a keyboard reader
 * could not reach a row at all until a query put the search cursor on one.
 */
describe("library rows by keyboard", () => {
  it("reaches a row without a query", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);

    const open = screen.getByRole("button", { name: /^Mastering the timeline/ });
    open.focus();
    expect(open).toHaveFocus();
  });

  it("opens a card with Enter", () => {
    const { workspace, items } = fixture();
    const { onOpenCard } = renderDrawer(workspace, items);
    const open = screen.getByRole("button", { name: /^Mastering the timeline/ });
    open.focus();

    fireEvent.click(open, { detail: 0 });

    expect(onOpenCard).toHaveBeenCalledWith("c1");
  });

  it("walks the rows with the arrows", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);
    const rows = screen.getAllByRole("button", {
      name: /^(Mastering the timeline|Interview notes)/,
    });
    const first = rows[0];
    const second = rows[1];
    if (!first || !second) throw new Error("the fixture has two rows");
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
  });

  it("places a card from the row's menu, reached from the keyboard", () => {
    const { workspace, items } = fixture();
    const onPlace = vi.fn();
    renderDrawer(workspace, items, { onPlace });
    const first = screen.getByRole("button", { name: /^Mastering the timeline/ });
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.click(screen.getByTestId("library-row-menu-c2"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Place on board" }));

    expect(onPlace).toHaveBeenCalledWith("c2");
  });
});

/**
 * The list had one order — title, or whatever a saved view asked for — and a
 * search that reached the ranking cap stopped without saying so.
 */
describe("library order and truncation", () => {
  it("reorders the list from the sort control", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items);
    const firstTitle = () => screen.getAllByTestId(/^library-title-/)[0]?.textContent ?? "";

    // Default: by title, so Interview notes leads.
    expect(firstTitle()).toContain("Interview notes");

    fireEvent.change(screen.getByTestId("library-sort"), { target: { value: "updated" } });

    // Nothing has been edited, so the last created card now leads.
    expect(firstTitle()).toContain("Interview notes");
    expect(screen.getByTestId("library-sort")).toHaveValue("updated");
  });

  it("says when a search stopped at its cap", async () => {
    const workspace = new Document();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const items: LibraryItem[] = [];
    for (let index = 0; index < 205; index += 1) {
      const id = `many-${index}`;
      workspace.createCard({ id, boardId: board.id, position: { x: index, y: 0 } });
      addText(workspace.getTitle(id), `Note ${index}`);
      items.push({
        id,
        title: workspace.displayTitle(id),
        boards: [{ id: board.id, name: board.name }],
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        properties: {},
      });
    }
    workspace.doc.commit({ origin: "test" });
    renderDrawer(workspace, items);

    expect(screen.queryByTestId("library-search-truncated")).toBeNull();
    type("note");

    await waitFor(() =>
      expect(screen.getByTestId("library-search-truncated")).toHaveTextContent("first 200"),
    );
  });
});

/**
 * "Delete forever" asked with `window.confirm`, the one platform question left
 * in the interface: it cannot be styled, cannot be read by the drawer's own
 * focus rules, and does not look like the rest of the app.
 */
describe("deleting a trashed card forever", () => {
  it("asks in the app's own dialog and names the card", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items, { tab: "trash", trash: items, cards: [] });

    rowAction("c1", "Delete forever");

    const dialog = screen.getByTestId("dialog");
    expect(dialog).toHaveTextContent("Delete this card forever?");
    expect(dialog).toHaveTextContent("Mastering the timeline");
  });

  it("deletes nothing when the reader cancels", () => {
    const { workspace, items } = fixture();
    const onDeleteForever = vi.fn();
    renderDrawer(workspace, items, { tab: "trash", trash: items, cards: [], onDeleteForever });

    rowAction("c1", "Delete forever");
    fireEvent.click(within(screen.getByTestId("dialog")).getByRole("button", { name: "Cancel" }));

    expect(onDeleteForever).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("deletes the card once the reader confirms", () => {
    const { workspace, items } = fixture();
    const onDeleteForever = vi.fn();
    renderDrawer(workspace, items, { tab: "trash", trash: items, cards: [], onDeleteForever });

    rowAction("c1", "Delete forever");
    fireEvent.click(
      within(screen.getByTestId("dialog")).getByRole("button", { name: "Delete forever" }),
    );

    expect(onDeleteForever).toHaveBeenCalledWith("c1");
  });
});
