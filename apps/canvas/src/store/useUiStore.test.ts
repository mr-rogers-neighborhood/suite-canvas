import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./useUiStore";

function resetUiState() {
  useUiStore.setState({
    focusTarget: null,
    editingNodeId: null,
    editingField: "body",
    editingSurface: "canvas",
    inspectorNodeId: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedSectionId: null,
    editingSectionId: null,
    selectedConnector: null,
    libraryTypeFilter: [],
    libraryTagFilter: [],
    librarySectionFilter: [],
    libraryScope: "all",
    libraryGroupBySection: false,
    outlineOpen: true,
  });
}

describe("useUiStore", () => {
  beforeEach(resetUiState);

  it("should carry the board id and bump the nonce on every focus request", () => {
    useUiStore.getState().focusCard("card-a", "board-1");
    const first = useUiStore.getState().focusTarget;

    expect(first).toMatchObject({ kind: "card", id: "card-a", boardId: "board-1" });

    useUiStore.getState().focusCard("card-a", "board-1");
    const repeated = useUiStore.getState().focusTarget;

    expect(repeated?.nonce).toBeGreaterThan(first?.nonce ?? 0);

    useUiStore.getState().focusSection("section-a", "board-2");
    const section = useUiStore.getState().focusTarget;

    expect(section).toMatchObject({ kind: "section", id: "section-a", boardId: "board-2" });
    expect(section?.nonce).toBeGreaterThan(repeated?.nonce ?? 0);

    useUiStore.getState().clearFocusTarget();
    expect(useUiStore.getState().focusTarget).toBeNull();
  });

  it("should record the editing surface and reset it when editing stops", () => {
    useUiStore.getState().startEditing("card-a", "title", "panel");

    expect(useUiStore.getState().editingSurface).toBe("panel");
    expect(useUiStore.getState().editingNodeId).toBe("card-a");
    expect(useUiStore.getState().editingField).toBe("title");

    useUiStore.getState().stopEditing();

    expect(useUiStore.getState().editingSurface).toBe("canvas");
    expect(useUiStore.getState().editingNodeId).toBeNull();
  });

  it("should default the editing surface to the canvas", () => {
    useUiStore.getState().startEditing("card-a");
    expect(useUiStore.getState().editingSurface).toBe("canvas");
  });

  it("should select every card on the board and drop the other selections", () => {
    useUiStore.setState({
      selectedSectionId: "section-a",
      editingSectionId: "section-a",
      selectedEdgeIds: ["edge-a"],
      selectedConnector: { nodeId: "card-a", connectorId: "connector-a" },
    });

    useUiStore.getState().selectAllOnBoard(["card-a", "card-b"]);

    const state = useUiStore.getState();
    expect(state.selectedNodeIds).toEqual(["card-a", "card-b"]);
    expect(state.selectedSectionId).toBeNull();
    expect(state.editingSectionId).toBeNull();
    expect(state.selectedEdgeIds).toEqual([]);
    expect(state.selectedConnector).toBeNull();
  });

  it("should leave the inspector closed when selecting all cards", () => {
    useUiStore.getState().selectAllOnBoard(["card-a"]);
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
  });

  it("should toggle section facet membership", () => {
    useUiStore.getState().toggleLibrarySection("section-a");
    useUiStore.getState().toggleLibrarySection("section-b");
    expect(useUiStore.getState().librarySectionFilter).toEqual(["section-a", "section-b"]);

    useUiStore.getState().toggleLibrarySection("section-a");
    expect(useUiStore.getState().librarySectionFilter).toEqual(["section-b"]);
  });

  it("should clear every library facet group", () => {
    useUiStore.setState({
      libraryTypeFilter: ["type-a"],
      libraryTagFilter: ["tag-a"],
      librarySectionFilter: ["section-a"],
    });

    useUiStore.getState().clearLibraryFilters();

    const state = useUiStore.getState();
    expect(state.libraryTypeFilter).toEqual([]);
    expect(state.libraryTagFilter).toEqual([]);
    expect(state.librarySectionFilter).toEqual([]);
  });
});
