import type { WorkspaceDocument } from "@suite/graph";
import { WorkspaceDocument as Document, PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoroMap, LoroText } from "loro-crdt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { Dock } from "./Dock";
import {
  type LibraryBoard,
  LibraryDrawer,
  type LibraryDrawerProps,
  type LibraryItem,
} from "./LibraryDrawer";

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

describe("Library shortcut", () => {
  function renderShell(workspace: WorkspaceDocument, items: LibraryItem[]): void {
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
            onClose={() => {}}
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
});

describe("LibraryDrawer boards", () => {
  interface BoardFixture {
    workspace: WorkspaceDocument;
    first: { id: string; name: string };
    second: { id: string; name: string };
    entries: (open?: string[]) => LibraryBoard[];
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
      entries: (open = [first.id]) =>
        workspace.listBoards().map((board) => ({
          id: board.id,
          title: board.name,
          open: open.includes(board.id),
          cardCount: workspace.listBoardCards(board.id).length,
        })),
    };
  }

  const rowIds = (): Array<string | null> =>
    screen.getAllByRole("listitem").map((row) => row.getAttribute("data-row-id"));

  it("should list every board, open or closed", () => {
    const { workspace, first, second, entries } = boardFixture();
    renderDrawer(workspace, [], { tab: "boards", boards: entries([second.id]) });

    expect(screen.getByTestId(`library-title-${first.id}`)).toHaveTextContent("Research");
    expect(screen.getByTestId(`library-title-${second.id}`)).toHaveTextContent("Drafts");
    expect(screen.getByTestId(`library-board-state-${first.id}`)).toHaveTextContent("Closed");
    expect(screen.getByTestId(`library-board-state-${second.id}`)).toHaveTextContent("Open");
  });

  it("should place a board without moving or removing its row", () => {
    const { workspace, first, second, entries } = boardFixture();
    const view = renderDrawer(workspace, [], {
      tab: "boards",
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
    fireEvent.click(screen.getByTestId(`library-board-place-${second.id}`));
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
      tab: "boards",
      boards: entries(),
      onUnplaceBoardCards: (boardId) => {
        for (const card of workspace.listBoardCards(boardId)) {
          workspace.unplaceCard(boardId, card.id);
        }
      },
    });

    fireEvent.click(screen.getByTestId(`library-board-unplace-${first.id}`));

    expect(workspace.listCardPlacements("c1").map((placement) => placement.boardId)).toEqual([
      second.id,
    ]);
    expect(workspace.getCard("c1")?.deletedAt ?? null).toBeNull();
  });

  it("should ask once and offer unplace or trash", () => {
    const { workspace, first, entries } = boardFixture();
    const onDeleteBoard = vi.fn();
    renderDrawer(workspace, [], { tab: "boards", boards: entries(), onDeleteBoard });

    fireEvent.click(screen.getByTestId(`library-board-delete-${first.id}`));

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
    renderDrawer(workspace, [], { tab: "boards", boards: entries(), onDeleteBoard });

    fireEvent.click(screen.getByTestId(`library-board-delete-${first.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Trash cards" }));

    expect(onDeleteBoard).toHaveBeenCalledWith(first.id, "trash");
  });

  it("should report a card that is not on the active board when locating it", () => {
    const { workspace, items } = fixture();
    renderDrawer(workspace, items, {
      tab: "cards",
      activeBoardId: "another-board",
      onLocateCard: () => false,
    });

    fireEvent.click(screen.getByTestId("library-locate-c1"));

    expect(screen.getByTestId("library-locate-miss")).toHaveTextContent(
      "\u201cMastering the timeline\u201d is not on this board.",
    );
  });

  it("should pan to a card that is on the active board when locating it", () => {
    const { workspace, items } = fixture();
    const onLocateCard = vi.fn(() => true);
    renderDrawer(workspace, items, { tab: "cards", onLocateCard });

    fireEvent.click(screen.getByTestId("library-locate-c1"));

    expect(onLocateCard).toHaveBeenCalledWith("c1");
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
