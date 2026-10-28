import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./useUiStore";

function resetUiState() {
  useUiStore.setState({
    focusTarget: null,
    editingNodeId: null,
    editingField: "body",
    editingSurface: "canvas",
    readOnly: false,
    inspectorNodeId: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedSectionId: null,
    editingSectionId: null,
    selectedConnector: null,
    purpose: "explore",
    tour: null,
    libraryTypeFilter: [],
    libraryTagFilter: [],
    librarySectionFilter: [],
    libraryScope: "all",
    libraryGroupBySection: false,
    outlineOpen: true,
    canEditContent: true,
    canEditLayout: true,
    canPublish: false,
    canCreateContent: true,
    canCreateBoards: true,
    canManageBoards: true,
    canManageSchema: true,
    canManageTrash: true,
    canManageLinks: true,
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

  it("should refuse to start an edit without content capability", () => {
    useUiStore.getState().setReadOnly(true);
    useUiStore.getState().setCapabilities({ canEditContent: false });

    useUiStore.getState().startEditing("card-a", "body", "panel");

    expect(useUiStore.getState().editingNodeId).toBeNull();
    expect(useUiStore.getState().editingField).toBe("body");
  });

  it("should allow an editor share to edit content without being read-only", () => {
    useUiStore.getState().setCapabilities({
      canEditLayout: false,
      canCreateContent: false,
      canCreateBoards: false,
      canManageBoards: false,
      canManageSchema: false,
      canManageTrash: false,
      canManageLinks: false,
    });

    useUiStore.getState().startEditing("card-a", "body", "panel");

    expect(useUiStore.getState().editingNodeId).toBe("card-a");
    expect(useUiStore.getState().canEditLayout).toBe(false);
    expect(useUiStore.getState().canManageSchema).toBe(false);
    expect(useUiStore.getState().canPublish).toBe(false);
  });

  it("should release the inspector's editing session on close", () => {
    useUiStore.getState().openInspector("card-a");
    useUiStore.getState().startEditing("card-a", "body", "panel");

    useUiStore.getState().closeInspector();

    const state = useUiStore.getState();
    expect(state.inspectorNodeId).toBeNull();
    expect(state.editingNodeId).toBeNull();
    expect(state.editingSurface).toBe("canvas");
  });

  it("should leave a canvas edit alone when the inspector closes", () => {
    useUiStore.getState().startEditing("card-a", "title", "canvas");
    useUiStore.getState().closeInspector();

    const state = useUiStore.getState();
    expect(state.editingNodeId).toBe("card-a");
    expect(state.editingSurface).toBe("canvas");
  });

  it("should keep a panel edit when the same card's inspector opens again", () => {
    useUiStore.getState().openInspector("card-a");
    useUiStore.getState().startEditing("card-a", "body", "panel");

    useUiStore.getState().openInspector("card-a");

    expect(useUiStore.getState().editingNodeId).toBe("card-a");
    expect(useUiStore.getState().editingSurface).toBe("panel");
  });

  it("should end the previous card's panel session when the inspector switches cards", () => {
    useUiStore.getState().openInspector("card-a");
    useUiStore.getState().startEditing("card-a", "body", "panel");

    useUiStore.getState().openInspector("card-b");

    const switched = useUiStore.getState();
    expect(switched.inspectorNodeId).toBe("card-b");
    expect(switched.editingNodeId).toBeNull();
    expect(switched.editingSurface).toBe("canvas");
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

describe("useUiStore board navigation", () => {
  beforeEach(() => {
    useUiStore.setState({
      activeBoardId: "board-a",
      boardViewports: {},
      boardHistory: [],
      viewportRequest: null,
      portalEntry: null,
      cardFocusId: null,
      editingNodeId: null,
      editingSurface: "canvas",
      editingSectionId: null,
      selectedEdgeIds: [],
      selectedConnector: null,
    });
  });

  it("should remember the board and viewport it came from", () => {
    useUiStore.getState().recordBoardViewport("board-a", { x: -40, y: 12, zoom: 0.75 });
    useUiStore.getState().activateBoard("board-b", { via: "portal" });

    const state = useUiStore.getState();
    expect(state.activeBoardId).toBe("board-b");
    expect(state.boardHistory).toEqual([
      { boardId: "board-a", viewport: { x: -40, y: 12, zoom: 0.75 }, via: "portal" },
    ]);
    expect(state.viewportRequest).toMatchObject({ boardId: "board-b", viewport: null });
  });

  it("should return to the exact previous board and viewport", () => {
    useUiStore.getState().recordBoardViewport("board-a", { x: 3, y: -9, zoom: 1.25 });
    useUiStore.getState().activateBoard("board-b", { via: "portal" });

    expect(useUiStore.getState().goBackBoard()).toBe(true);

    const state = useUiStore.getState();
    expect(state.activeBoardId).toBe("board-a");
    expect(state.boardHistory).toEqual([]);
    expect(state.viewportRequest).toMatchObject({
      boardId: "board-a",
      viewport: { x: 3, y: -9, zoom: 1.25 },
    });
    // Nothing left to go back to.
    expect(useUiStore.getState().goBackBoard()).toBe(false);
  });

  it("should treat A → B → A as two visits, not a switch in place", () => {
    useUiStore.getState().activateBoard("board-b", { via: "portal" });
    useUiStore.getState().activateBoard("board-a", { via: "portal" });

    expect(useUiStore.getState().activeBoardId).toBe("board-a");
    expect(useUiStore.getState().boardHistory.map((entry) => entry.boardId)).toEqual([
      "board-a",
      "board-b",
    ]);

    useUiStore.getState().goBackBoard();
    expect(useUiStore.getState().activeBoardId).toBe("board-b");
    useUiStore.getState().goBackBoard();
    expect(useUiStore.getState().activeBoardId).toBe("board-a");
  });

  it("should ignore a repeated activation of the board already on screen", () => {
    useUiStore.getState().activateBoard("board-a");
    expect(useUiStore.getState().boardHistory).toEqual([]);
    expect(useUiStore.getState().viewportRequest).toBeNull();
  });

  it("should keep only one portal transition in flight", () => {
    const rect = { left: 10, top: 20, width: 100, height: 80 };
    useUiStore.getState().requestPortalEntry({ nodeId: "n1", targetBoardId: "b2", rect });
    useUiStore.getState().requestPortalEntry({ nodeId: "n2", targetBoardId: "b3", rect });

    expect(useUiStore.getState().portalEntry?.nodeId).toBe("n1");
    useUiStore.getState().clearPortalEntry();
    useUiStore.getState().requestPortalEntry({ nodeId: "n2", targetBoardId: "b3", rect });
    expect(useUiStore.getState().portalEntry?.nodeId).toBe("n2");
  });

  it("should open one placeholder tab and close it by choosing a board", () => {
    useUiStore.getState().openNewTab();

    expect(useUiStore.getState().newTab).toBe(true);
    expect(useUiStore.getState().activeBoardId).toBeNull();
    // The board that was on screen is still the most recent: leaving a tab is
    // not a visit to a different board.
    expect(useUiStore.getState().boardRecency[0]).toBe("board-a");

    useUiStore.getState().activateBoard("board-b");
    expect(useUiStore.getState().newTab).toBe(false);
    expect(useUiStore.getState().activeBoardId).toBe("board-b");
  });

  it("should not stack a second placeholder on the first", () => {
    useUiStore.getState().openNewTab();
    const first = useUiStore.getState();
    useUiStore.getState().openNewTab();
    expect(useUiStore.getState()).toBe(first);
  });

  it("should reset editing and focus when the board changes", () => {
    useUiStore.getState().startEditing("card-a", "body", "focus");
    useUiStore.getState().openCardFocus("card-a");

    useUiStore.getState().activateBoard("board-b");

    const state = useUiStore.getState();
    expect(state.cardFocusId).toBeNull();
    expect(state.editingNodeId).toBeNull();
    expect(state.editingSurface).toBe("canvas");
  });
});

describe("useUiStore card focus", () => {
  beforeEach(() => {
    useUiStore.setState({
      cardFocusId: null,
      inspectorNodeId: null,
      inspectorFieldId: null,
      editingNodeId: null,
      editingField: "body",
      editingSurface: "canvas",
      canEditContent: true,
    });
  });

  it("should open focus mode and stop focus editing when it closes", () => {
    useUiStore.getState().openCardFocus("card-a");
    expect(useUiStore.getState().cardFocusId).toBe("card-a");

    useUiStore.getState().startEditing("card-a", "body", "focus");
    useUiStore.getState().closeCardFocus();

    const state = useUiStore.getState();
    expect(state.cardFocusId).toBeNull();
    expect(state.editingNodeId).toBeNull();
    expect(state.editingSurface).toBe("canvas");
  });

  it("should leave focus mode when the inspector closes", () => {
    useUiStore.getState().openInspector("card-a");
    useUiStore.getState().openCardFocus("card-a");
    useUiStore.getState().startEditing("card-a", "body", "focus");

    useUiStore.getState().closeInspector();

    const state = useUiStore.getState();
    expect(state.inspectorNodeId).toBeNull();
    expect(state.cardFocusId).toBeNull();
    expect(state.editingSurface).toBe("canvas");
  });

  it("should close focus mode when the inspector opens another card", () => {
    useUiStore.getState().openCardFocus("card-a");
    useUiStore.getState().openInspector("card-b");
    expect(useUiStore.getState().cardFocusId).toBeNull();
  });
});

describe("useUiStore purpose", () => {
  beforeEach(resetUiState);

  it("defaults to explore and cycles through the axis", () => {
    expect(useUiStore.getState().purpose).toBe("explore");

    useUiStore.getState().setPurpose("explain");
    expect(useUiStore.getState().purpose).toBe("explain");

    useUiStore.getState().setPurpose("record");
    expect(useUiStore.getState().purpose).toBe("record");
  });

  it("refuses to present without a tour, because there is nothing to show", () => {
    useUiStore.getState().setPurpose("present");

    expect(useUiStore.getState().purpose).toBe("explore");
  });

  it("is put into present by the tour, which is the only thing that may", () => {
    useUiStore.setState({
      tour: { tutorialId: "t1", stepIndex: 0, presenting: false, panelOpen: true },
    });

    useUiStore.getState().presentTour("t1");

    expect(useUiStore.getState().purpose).toBe("present");
    expect(useUiStore.getState().tour?.presenting).toBe(true);
  });

  it("refuses present from the axis, because a mode button presents nothing", () => {
    useUiStore.setState({
      tour: { tutorialId: "t1", stepIndex: 0, presenting: false, panelOpen: true },
      purpose: "explore",
    });

    // Even with a tour open and ready: offering "present" here would be offering
    // to present nothing and then asking which tour (§11).
    useUiStore.getState().setPurpose("present");

    expect(useUiStore.getState().purpose).toBe("explore");
    expect(useUiStore.getState().tour?.presenting).toBe(false);
  });

  it("stops the takeover without closing the tour when the axis leaves present", () => {
    useUiStore.setState({
      tour: { tutorialId: "t1", stepIndex: 0, presenting: true, panelOpen: true },
      purpose: "present",
    });

    useUiStore.getState().setPurpose("explore");

    // Back to editing with the steps still open: Escape is the way to close it.
    expect(useUiStore.getState().tour).not.toBeNull();
    expect(useUiStore.getState().tour?.presenting).toBe(false);
  });

  it("leaves present when the tour it was presenting closes", () => {
    useUiStore.setState({
      tour: { tutorialId: "t1", stepIndex: 0, presenting: false, panelOpen: true },
    });
    useUiStore.getState().presentTour("t1");

    useUiStore.getState().closeTour();

    // The axis cannot outlive the thing it describes: a presentation with no tour
    // is a state a reader could neither enter deliberately nor leave by choosing it.
    expect(useUiStore.getState().purpose).toBe("explore");
  });

  it("keeps the other purposes when a tour closes under them", () => {
    useUiStore.setState({
      tour: { tutorialId: "t1", stepIndex: 0, presenting: false, panelOpen: true },
    });
    useUiStore.getState().setPurpose("explain");

    useUiStore.getState().closeTour();

    expect(useUiStore.getState().purpose).toBe("explain");
  });
});

describe("useUiStore folds", () => {
  it("folds and unfolds one card without touching its neighbours", () => {
    useUiStore.setState({ collapsedCards: {}, collapsedSections: {} });

    useUiStore.getState().toggleCardCollapsed("card-a");
    useUiStore.getState().toggleCardCollapsed("card-b");
    expect(useUiStore.getState().collapsedCards).toEqual({ "card-a": true, "card-b": true });

    useUiStore.getState().toggleCardCollapsed("card-a");
    expect(useUiStore.getState().collapsedCards).toEqual({ "card-b": true });
  });

  it("keeps card folds and section folds apart", () => {
    useUiStore.setState({ collapsedCards: {}, collapsedSections: {} });

    useUiStore.getState().toggleSectionCollapsed("section-1");

    expect(useUiStore.getState().collapsedSections).toEqual({ "section-1": true });
    expect(useUiStore.getState().collapsedCards).toEqual({});
  });
});
