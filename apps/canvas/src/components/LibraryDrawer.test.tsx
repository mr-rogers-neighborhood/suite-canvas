import type { WorkspaceDocument } from "@suite/graph";
import { WorkspaceDocument as Document } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoroMap, LoroText } from "loro-crdt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { Dock } from "./Dock";
import { LibraryDrawer, type LibraryDrawerProps, type LibraryItem } from "./LibraryDrawer";

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
  const board = workspace.ensureView();

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
    counts: { inbox: 0, cards: items.length, pins: 0, trash: 0 },
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
    const boardId = workspace.listViews()[0]?.id ?? "";
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
            counts={{ inbox: 0, cards: items.length, pins: 0, trash: 0 }}
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

  it("should open the library on Cards and focus the search box from Cmd+K", () => {
    const { workspace, items } = fixture();
    renderShell(workspace, items);

    expect(screen.queryByTestId("library-search")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(useUiStore.getState().libraryOpen).toBe(true);
    expect(useUiStore.getState().libraryTab).toBe("cards");
    expect(screen.getByTestId("library-search")).toHaveFocus();
  });
});

describe("LibraryDrawer drop on the canvas", () => {
  /**
   * The drop asks the document what sits under the pointer. That test id used to
   * be `canvas-board`, which stopped existing when the ICE surface replaced React
   * Flow, so every drop was silently inert. `ice-surface` is the only canvas root.
   */
  function pointerDrop(over: "surface" | null): ReturnType<typeof vi.fn> {
    const { workspace, items } = fixture();
    const onDropAt = vi.fn();
    renderDrawer(workspace, items, { onDropAt });
    const surface = document.createElement("div");
    surface.setAttribute("data-testid", "ice-surface");
    const child = document.createElement("div");
    surface.append(child);
    document.body.append(surface);
    // jsdom has no layout, so it defines no `elementFromPoint` at all.
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => (over === null ? null : child),
    });

    const row = screen.getByTestId("library-item-c1");
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 180 });
    fireEvent.pointerUp(window, { clientX: 240, clientY: 180 });
    surface.remove();
    Reflect.deleteProperty(document, "elementFromPoint");
    return onDropAt;
  }

  it("should drop a row on the canvas under the pointer", () => {
    const onDropAt = pointerDrop("surface");

    expect(onDropAt).toHaveBeenCalledWith("c1", { x: 240, y: 180 });
  });

  it("should ignore a drag that ends away from the canvas", () => {
    expect(pointerDrop(null)).not.toHaveBeenCalled();
  });
});
