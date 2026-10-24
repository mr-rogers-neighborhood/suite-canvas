import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoroMap, LoroText } from "loro-crdt";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { LibraryDrawer, type LibraryItem } from "./LibraryDrawer";
import { ViewsBar } from "./ViewsBar";

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

function fixture(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureView();
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  addText(workspace.getTitle("c1"), "Grading notes");
  addText(addNode(workspace.getContent("c1"), "paragraph"), "colour grading in the second pass");
  workspace.doc.commit({ origin: "test" });
  return workspace;
}

function resetStore(): void {
  useUiStore.setState({
    activeViewId: null,
    libraryQuery: "",
    libraryTypeFilter: [],
    libraryTagFilter: [],
    librarySectionFilter: [],
    libraryScope: "all",
    libraryGroupBySection: false,
    libraryOpen: false,
    libraryTab: "inbox",
  });
}

beforeEach(resetStore);

describe("ViewsBar", () => {
  it("should save the current search, apply it, and exit", () => {
    const workspace = fixture();
    useUiStore.setState({
      libraryQuery: "grading",
      libraryTypeFilter: ["note"],
      libraryOpen: true,
      libraryTab: "cards",
    });
    render(<ViewsBar workspace={workspace} canManage />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    fireEvent.click(screen.getByTestId("views-save"));
    const input = screen.getByTestId("views-save-input");
    expect(input).toHaveValue("grading");

    fireEvent.change(input, { target: { value: "Grading pass" } });
    fireEvent.click(screen.getByTestId("views-save-commit"));

    const [saved] = workspace.listSavedViews();
    expect(saved?.name).toBe("Grading pass");
    expect(saved?.query).toMatchObject({
      text: "grading",
      typeIds: ["note"],
      scope: "all",
      order: "relevance",
    });
    expect(useUiStore.getState().activeViewId).toBe(saved?.id ?? null);
    expect(useUiStore.getState().libraryTab).toBe("cards");
    expect(useUiStore.getState().libraryOpen).toBe(true);

    // The saved view can be reopened from the menu and applied again.
    useUiStore.setState({ activeViewId: null, libraryTypeFilter: [] });
    fireEvent.click(screen.getByTestId("views-menu-button"));
    fireEvent.click(screen.getByTestId(`views-item-${saved?.id}`));
    expect(useUiStore.getState().activeViewId).toBe(saved?.id ?? null);
    expect(useUiStore.getState().libraryTypeFilter).toEqual(["note"]);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    fireEvent.click(screen.getByTestId("views-exit"));
    expect(useUiStore.getState().activeViewId).toBeNull();
    expect(useUiStore.getState().libraryQuery).toBe("");
    expect(useUiStore.getState().libraryTypeFilter).toEqual([]);
  });

  it("should rename and delete a view inline, with delete confirmed", () => {
    const workspace = fixture();
    const saved = workspace.createSavedView({
      name: "Drafts",
      query: {
        text: "grading",
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "relevance",
      },
    });
    render(<ViewsBar workspace={workspace} canManage />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    fireEvent.click(screen.getByTestId(`views-rename-${saved.id}`));
    const input = screen.getByTestId("views-rename-input");
    fireEvent.change(input, { target: { value: "Colour" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(workspace.getSavedView(saved.id)?.name).toBe("Colour");

    fireEvent.click(screen.getByTestId(`views-delete-${saved.id}`));
    // Nothing is deleted until the inline confirmation is used.
    expect(workspace.getSavedView(saved.id)?.name).toBe("Colour");
    fireEvent.click(screen.getByTestId("views-delete-confirm"));
    expect(workspace.listSavedViews()).toEqual([]);
    expect(screen.getByTestId("views-empty")).toBeInTheDocument();
  });

  it("should exit the active view when its own record is deleted", () => {
    const workspace = fixture();
    const saved = workspace.createSavedView({
      name: "Drafts",
      query: {
        text: "grading",
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "relevance",
      },
    });
    useUiStore.setState({ activeViewId: saved.id, libraryQuery: "grading" });
    render(<ViewsBar workspace={workspace} canManage />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    fireEvent.click(screen.getByTestId(`views-delete-${saved.id}`));
    fireEvent.click(screen.getByTestId("views-delete-confirm"));

    expect(useUiStore.getState().activeViewId).toBeNull();
    expect(useUiStore.getState().libraryQuery).toBe("");
  });

  it("should not offer saving, renaming or deleting to a viewer", () => {
    const workspace = fixture();
    const saved = workspace.createSavedView({
      name: "Drafts",
      query: {
        text: "grading",
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "relevance",
      },
    });
    useUiStore.setState({ libraryQuery: "grading" });
    render(<ViewsBar workspace={workspace} canManage={false} />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    expect(screen.queryByTestId("views-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`views-rename-${saved.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`views-delete-${saved.id}`)).not.toBeInTheDocument();

    // A viewer may still open the saved query read-only.
    fireEvent.click(screen.getByTestId(`views-item-${saved.id}`));
    expect(useUiStore.getState().activeViewId).toBe(saved.id);
    expect(workspace.listSavedViews()).toHaveLength(1);
  });

  it("should offer no save action when the library has no query or facets", () => {
    const workspace = fixture();
    render(<ViewsBar workspace={workspace} canManage />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    expect(screen.getByTestId("views-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("views-save")).not.toBeInTheDocument();
  });

  it("should show the applied view in the library and fill its query", () => {
    const workspace = fixture();
    const item: LibraryItem = {
      id: "c1",
      title: "Grading notes",
      boards: [],
      typeIds: ["note"],
      tagIds: [],
      sectionIds: [],
      properties: {},
    };
    const saved = workspace.createSavedView({
      name: "Colour",
      query: {
        text: "grading",
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "relevance",
      },
    });

    render(
      <>
        <ViewsBar workspace={workspace} canManage />
        <LibraryDrawer
          open
          tab="cards"
          counts={{ inbox: 0, cards: 1, pins: 0, trash: 0 }}
          inbox={[]}
          cards={[item]}
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
      </>,
    );

    fireEvent.click(screen.getByTestId("views-menu-button"));
    fireEvent.click(screen.getByTestId(`views-item-${saved.id}`));

    expect(screen.getByTestId("library-active-view")).toHaveTextContent("Colour");
    expect(screen.getByTestId("library-search")).toHaveValue("grading");
    expect(screen.getByTestId("library-item-c1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-exit-view"));
    expect(screen.queryByTestId("library-active-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("library-search")).toHaveValue("");
    expect(useUiStore.getState().activeViewId).toBeNull();
  });
});
