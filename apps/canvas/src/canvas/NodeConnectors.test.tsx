import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, useStore, useStoreApi } from "@xyflow/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureWhiteboardType, WHITEBOARD_TYPE_ID } from "../cards/whiteboard";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { CanvasBoard } from "./CanvasBoard";
import { useLinkThreadStore } from "./links/linkThread";
import { NodeConnectors, revealConnectors } from "./NodeConnectors";
import { useLinkDraftStore } from "./useNodeConnectorWiring";

// React Flow measures its container; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const workspace = useCanvasStore.getState().workspace;
let boardId = "";
let targetBoardId = "";

const NOTE_ID = "connector-note";
const PORTAL_ID = "connector-portal";
const SKETCH_ID = "connector-sketch";

const FULL_CAPABILITIES = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: true,
} as const;

const originalRect = Element.prototype.getBoundingClientRect;
const originalCapture = Element.prototype.setPointerCapture;

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  boardId = workspace.ensureBoard().id;
  targetBoardId = workspace.createBoard({ name: "Connector target" }).id;
  ensureWhiteboardType(workspace);

  workspace.createCard({ id: NOTE_ID, typeId: "note", boardId, position: { x: 0, y: 0 } });
  workspace.createPortalCard({
    id: PORTAL_ID,
    boardId,
    targetBoardId,
    position: { x: 320, y: 0 },
  });
  workspace.createCard({
    id: SKETCH_ID,
    typeId: WHITEBOARD_TYPE_ID,
    boardId,
    position: { x: 640, y: 0 },
  });

  // jsdom reports zero-sized boxes; connector gestures measure the node face.
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 240,
      height: 160,
      right: 240,
      bottom: 160,
      toJSON: () => ({}),
    }) as DOMRect;
  Element.prototype.setPointerCapture = () => {};
});

afterEach(cleanup);

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  Element.prototype.setPointerCapture = originalCapture;
  useUiStore.setState({
    readOnly: false,
    activeBoardId: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedSectionId: null,
    contextMenu: null,
    ...FULL_CAPABILITIES,
  });
  cleanup();
});

/** The links React Flow was handed, as `source>target` node ids. */
function EdgeProbe() {
  const edges = useStore((state) => state.edges);
  return (
    <span
      data-testid="edges"
      data-edges={edges.map((edge) => `${edge.source}>${edge.target}`).join(",")}
    />
  );
}

/**
 * Lets a test drive the canvas's own connect handlers, which is how a pointer
 * drop reaches the document once React Flow has resolved the gesture.
 */
let flowApi: ReturnType<typeof useStoreApi> | null = null;

function FlowProbe() {
  flowApi = useStoreApi();
  return null;
}

function mount({ selectedSectionId = null }: { selectedSectionId?: string | null } = {}) {
  useUiStore.setState({
    readOnly: false,
    activeBoardId: boardId,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedSectionId,
    contextMenu: null,
    ...FULL_CAPABILITIES,
  });
  return render(
    <ReactFlowProvider>
      <CanvasBoard />
      <EdgeProbe />
      <FlowProbe />
    </ReactFlowProvider>,
  );
}

/**
 * Selects cards through the UI store. React Flow mirrors its own selection into
 * the store, so a changed key repaints the nodes as selected — the same path a
 * marquee or a dock action takes.
 */
async function mountSelected(ids: string[]) {
  const view = mount();
  await waitFor(() => expect(view.container.querySelector(".react-flow__node")).not.toBeNull());
  act(() => useUiStore.setState({ selectedNodeIds: ids }));
  return view;
}

/** The React Flow node wrapper for a card, whatever kind of face it paints. */
function nodeOf(container: HTMLElement, nodeId: string): Element | null {
  return container.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
}

/** The dots a node face paints, whichever kind of card it is. */
function dotsOf(container: HTMLElement, nodeId: string): Element[] {
  const node = nodeOf(container, nodeId);
  return node ? [...node.querySelectorAll('[data-testid="connector"]')] : [];
}

/**
 * Whether a node's dots are *revealed*. Handles stay mounted so React Flow can
 * start a connection from them, so "hidden" is a visibility rule the layer
 * publishes, not the absence of the elements.
 */
function isRevealed(container: HTMLElement, nodeId: string): boolean {
  const node = nodeOf(container, nodeId);
  const layer = node?.querySelector('[data-testid="node-connectors"]');
  return layer?.getAttribute("data-revealed") === "true";
}

describe("connector reveal rule", () => {
  it("should reveal for a peer's live gesture, even with nothing local happening", () => {
    // A peer's dot and name tag are painted inside this layer, so hiding it while
    // they hold one makes their gesture invisible to everyone else.
    expect(revealConnectors({ peerActive: true })).toBe(true);
    expect(revealConnectors({})).toBe(false);
  });

  it("should paint no dots on unselected nodes", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    expect(isRevealed(container, NOTE_ID)).toBe(false);
    expect(isRevealed(container, PORTAL_ID)).toBe(false);
    expect(isRevealed(container, SKETCH_ID)).toBe(false);
    // Every kind still holds its four handles: React Flow needs them measured.
    expect(dotsOf(container, NOTE_ID)).toHaveLength(4);
  });

  it("should reveal a node's dots once it is selected", async () => {
    const { container } = await mountSelected([PORTAL_ID]);
    await waitFor(() => expect(isRevealed(container, PORTAL_ID)).toBe(true));

    // The rule is per entity: selecting one node does not wire up the others.
    expect(isRevealed(container, NOTE_ID)).toBe(false);
    expect(isRevealed(container, SKETCH_ID)).toBe(false);
    expect(dotsOf(container, PORTAL_ID)).toHaveLength(4);
  });

  it("should reveal every node's dots while a link drag is in flight", async () => {
    const { container } = await mountSelected([NOTE_ID]);
    await waitFor(() => expect(isRevealed(container, NOTE_ID)).toBe(true));
    expect(isRevealed(container, PORTAL_ID)).toBe(false);

    // Mid-gesture the drop targets must be visible, or the user drags blind.
    // The canvas owns the gesture; this is the flag it publishes for it.
    act(() => useLinkDraftStore.getState().setDraftActive(true));
    await waitFor(() => expect(isRevealed(container, PORTAL_ID)).toBe(true));
    expect(isRevealed(container, SKETCH_ID)).toBe(true);

    // Releasing returns to the selection-only rule.
    act(() => useLinkDraftStore.getState().setDraftActive(false));
    await waitFor(() => expect(isRevealed(container, PORTAL_ID)).toBe(false));
    expect(isRevealed(container, SKETCH_ID)).toBe(false);
    expect(isRevealed(container, NOTE_ID)).toBe(true);
  });

  it("should paint the same four dots on every selected kind", async () => {
    const { container } = await mountSelected([NOTE_ID, PORTAL_ID, SKETCH_ID]);
    await waitFor(() => expect(dotsOf(container, NOTE_ID)).toHaveLength(4));

    // One fixture, three faces: the connector layer is shared, not copied, and
    // a multi-selection keeps all of them revealed.
    expect(dotsOf(container, NOTE_ID)).toHaveLength(4);
    expect(dotsOf(container, PORTAL_ID)).toHaveLength(4);
    expect(dotsOf(container, SKETCH_ID)).toHaveLength(4);
  });
});

describe("connectors on every node kind", () => {
  it("should drag a portal's connector and persist the new position", async () => {
    const { container } = await mountSelected([PORTAL_ID]);
    await waitFor(() => expect(dotsOf(container, PORTAL_ID)).toHaveLength(4));

    const connectorId = workspace.getCard(PORTAL_ID)?.connectors[0]?.id;
    if (!connectorId) throw new Error("portal has no connector");

    const dot = container.querySelector(
      `.react-flow__node[data-id="${PORTAL_ID}"] [data-connector-id="${connectorId}"] [data-testid="connector-dot"]`,
    );
    fireEvent.click(dot as HTMLElement);
    await waitFor(() =>
      expect(
        container.querySelector(`[data-node-id="${PORTAL_ID}"] [data-testid="connector-grab"]`),
      ).not.toBeNull(),
    );

    const move = vi.spyOn(workspace, "moveConnector");
    const grab = container.querySelector(
      `.react-flow__node[data-id="${PORTAL_ID}"] [data-testid="connector-grab"]`,
    ) as HTMLElement;
    fireEvent.pointerDown(grab, { button: 0, clientX: 240, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 0 });

    expect(move).toHaveBeenCalledWith(PORTAL_ID, connectorId, expect.anything());
    move.mockRestore();
  });

  it("should remove a sketch's connector from its dot menu", async () => {
    const { container } = await mountSelected([SKETCH_ID]);
    await waitFor(() => expect(dotsOf(container, SKETCH_ID)).toHaveLength(4));

    const connectorId = workspace.getCard(SKETCH_ID)?.connectors[0]?.id;
    if (!connectorId) throw new Error("sketch has no connector");

    fireEvent.contextMenu(
      container.querySelector(
        `.react-flow__node[data-id="${SKETCH_ID}"] [data-connector-id="${connectorId}"] [data-testid="connector-dot"]`,
      ) as HTMLElement,
      { clientX: 40, clientY: 40 },
    );

    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete connector" }));

    expect(workspace.getCard(SKETCH_ID)?.connectors).toHaveLength(3);
    expect(
      container.querySelector(`[data-node-id="${SKETCH_ID}"] [data-connector-id="${connectorId}"]`),
    ).toBeNull();
  });

  it("should add a connector to a portal from the node menu", async () => {
    const { container } = await mountSelected([PORTAL_ID]);
    await waitFor(() => expect(dotsOf(container, PORTAL_ID)).toHaveLength(4));

    fireEvent.contextMenu(container.querySelector(`[data-node-id="${PORTAL_ID}"]`) as HTMLElement, {
      clientX: 40,
      clientY: 40,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add connector" }));

    await waitFor(() => expect(dotsOf(container, PORTAL_ID)).toHaveLength(5));
  });
});

describe("link projection", () => {
  it("should draw a board-targeted link through the portal that opens it", async () => {
    const target = workspace.createBoard({ name: "Board link target" }).id;
    const portal = workspace.createPortalCard({
      id: "portal-for-board-link",
      boardId,
      targetBoardId: target,
      position: { x: 0, y: 900 },
    });
    const note = workspace.createCard({
      id: "note-for-board-link",
      typeId: "note",
      boardId,
      position: { x: 400, y: 900 },
    });
    const edge = workspace.addEdge({
      boardId,
      source: note.id,
      target,
      sourceConnector: note.connectors[0]?.id,
      targetKind: "board",
    });
    if (!edge) throw new Error("link was not created");

    const { container, getByTestId } = mount();
    await waitFor(() => expect(getByTestId("edges").dataset.edges).toContain(note.id));

    // A board endpoint has no node of its own: the portal stands in for it.
    expect(getByTestId("edges").dataset.edges).toContain(`${note.id}>${portal.id}`);
    expect(
      container.querySelector(`[data-testid="section-link"][data-edge-id="${edge.id}"]`),
    ).toBeNull();
  });

  it("should draw a link to a section in flow space, not as a React Flow edge", async () => {
    const section = workspace.createSection({
      boardId,
      title: "Linked band",
      x: 0,
      y: 1200,
      width: 400,
      height: 240,
    });
    const note = workspace.createCard({
      id: "note-for-section-link",
      typeId: "note",
      boardId,
      position: { x: 500, y: 1200 },
    });
    const edge = workspace.addEdge({
      boardId,
      source: note.id,
      target: section.id,
      sourceConnector: note.connectors[0]?.id,
      targetKind: "section",
    });
    if (!edge) throw new Error("link was not created");

    const { container, getByTestId } = mount();

    // A section is not a node, so its line is drawn by the section link layer.
    await waitFor(() =>
      expect(
        container.querySelector(`[data-testid="section-link"][data-edge-id="${edge.id}"]`),
      ).not.toBeNull(),
    );
    expect(getByTestId("edges").dataset.edges).not.toContain(edge.id);
  });

  it("should keep a board link in the document but stop drawing it when the portal leaves", async () => {
    const target = workspace.createBoard({ name: "Orphaned link target" }).id;
    workspace.createPortalCard({
      id: "portal-to-unplace",
      boardId,
      targetBoardId: target,
      position: { x: 0, y: 1500 },
    });
    const note = workspace.createCard({
      id: "note-for-unplaced-portal",
      typeId: "note",
      boardId,
      position: { x: 400, y: 1500 },
    });
    const edge = workspace.addEdge({
      boardId,
      source: note.id,
      target,
      sourceConnector: note.connectors[0]?.id,
      targetKind: "board",
    });
    if (!edge) throw new Error("link was not created");

    const { getByTestId } = mount();
    await waitFor(() =>
      expect(getByTestId("edges").dataset.edges).toContain(`${note.id}>portal-to-unplace`),
    );

    workspace.unplaceCard(boardId, "portal-to-unplace");

    await waitFor(() => expect(getByTestId("edges").dataset.edges).not.toContain(edge.id));
    // The document keeps the link whatever the board can draw.
    expect(workspace.listLinksTo("board", target).map((entry) => entry.id)).toEqual([edge.id]);
  });
});

describe("section connectors", () => {
  function makeSection(id: string, title: string, y = 1800) {
    return workspace.createSection({
      id,
      boardId,
      title,
      x: 0,
      y,
      width: 400,
      height: 240,
    });
  }

  it("should paint a dot for every connector of the selected section only", async () => {
    const section = makeSection("connector-section-render", "Render band");
    const other = makeSection("connector-section-other", "Other band", 2400);
    const { container } = mount({ selectedSectionId: section.id });

    const dots = await waitFor(() => {
      const found = container.querySelectorAll(
        `[data-section-id="${section.id}"][data-testid="section-connector"]`,
      );
      if (found.length === 0) throw new Error("no section connectors");
      return found;
    });
    expect(dots).toHaveLength(section.connectors?.length ?? 0);
    expect(
      container.querySelectorAll(
        `[data-section-id="${other.id}"][data-testid="section-connector"]`,
      ),
    ).toHaveLength(0);
  });

  it("should not start dragging the section from a connector dot", async () => {
    const section = makeSection("connector-section-gesture", "Gesture band", 3000);
    const connectorId = section.connectors?.[0]?.id;
    if (!connectorId) throw new Error("section has no connector");

    const { container } = mount({ selectedSectionId: section.id });
    const selector = `[data-section-id="${section.id}"][data-connector-id="${connectorId}"]`;
    await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());

    const moveSections = vi.spyOn(workspace, "moveSectionsBatch");
    const moveConnector = vi.spyOn(workspace, "moveSectionConnector");

    fireEvent.pointerDown(container.querySelector(selector) as HTMLElement, {
      button: 0,
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 160 });
    fireEvent.pointerUp(window, { clientX: 160, clientY: 160 });

    // The child gesture is a connector gesture; the section must stay put.
    expect(moveSections).not.toHaveBeenCalled();
    expect(moveConnector).not.toHaveBeenCalled();
    moveSections.mockRestore();
    moveConnector.mockRestore();

    // Control: the same gesture on the header is a section drag.
    const drag = vi.spyOn(workspace, "moveSectionsBatch");
    fireEvent.pointerDown(
      container.querySelector(`[data-testid="section-header-${section.id}"]`) as HTMLElement,
      { button: 0, clientX: 20, clientY: 20 },
    );
    fireEvent.pointerMove(window, { clientX: 160, clientY: 160 });
    fireEvent.pointerUp(window, { clientX: 160, clientY: 160 });

    expect(drag).toHaveBeenCalled();
    drag.mockRestore();
  });

  it("should move a section connector and persist it on release", async () => {
    const section = makeSection("connector-section-move", "Move band", 3600);
    const connectorId = section.connectors?.[0]?.id;
    if (!connectorId) throw new Error("section has no connector");

    const { container } = mount({ selectedSectionId: section.id });
    const selector = `[data-section-id="${section.id}"][data-connector-id="${connectorId}"]`;
    await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());

    fireEvent.pointerDown(container.querySelector(selector) as HTMLElement, {
      button: 0,
      clientX: 10,
      clientY: 10,
    });

    const grab = await waitFor(() => {
      const found = container.querySelector(
        `[data-section-id="${section.id}"] [data-testid="section-connector-grab"]`,
      );
      if (!found) throw new Error("no grab ring");
      return found as HTMLElement;
    });

    const move = vi.spyOn(workspace, "moveSectionConnector");
    fireEvent.pointerDown(grab, { button: 0, clientX: 240, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 240, clientY: 80 });

    expect(move).toHaveBeenCalledWith(section.id, connectorId, expect.anything());
    move.mockRestore();
  });

  it("should add and remove a section connector from the menus", async () => {
    const section = makeSection("connector-section-menu", "Menu band", 4200);
    const before = workspace.getSection(section.id)?.connectors?.length ?? 0;

    const { container } = mount({ selectedSectionId: section.id });
    await waitFor(() =>
      expect(
        container.querySelector(`[data-testid="section-region-${section.id}"]`),
      ).not.toBeNull(),
    );

    fireEvent.contextMenu(
      container.querySelector(`[data-testid="section-header-${section.id}"]`) as HTMLElement,
      { clientX: 40, clientY: 40 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add connector" }));

    const grown = workspace.getSection(section.id)?.connectors ?? [];
    expect(grown).toHaveLength(before + 1);

    const added = grown.at(-1);
    if (!added) throw new Error("no connector added");

    const dot = await waitFor(() => {
      const found = container.querySelector(
        `[data-section-id="${section.id}"][data-connector-id="${added.id}"]`,
      );
      if (!found) throw new Error("no section connector dot");
      return found as HTMLElement;
    });
    fireEvent.contextMenu(dot, { clientX: 40, clientY: 40 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete connector" }));

    expect(workspace.getSection(section.id)?.connectors).toHaveLength(before);
  });
});

describe("thread mode", () => {
  const connectors = [
    { id: "t-top", x: 0.5, y: 0 },
    { id: "t-bottom", x: 0.5, y: 1 },
  ];

  it("should reveal the dots of an unselected node", () => {
    render(
      <ReactFlowProvider>
        <NodeConnectors nodeId="thread-node" connectors={connectors} chaining />
      </ReactFlowProvider>,
    );

    expect(screen.getAllByTestId("connector")).toHaveLength(connectors.length);
    expect(screen.getByTestId("node-connectors")).toHaveAttribute("data-revealed", "true");
  });

  it("should stay hidden without a selection or thread mode", () => {
    render(
      <ReactFlowProvider>
        <NodeConnectors nodeId="thread-node" connectors={connectors} />
      </ReactFlowProvider>,
    );

    expect(screen.getByTestId("node-connectors")).toHaveAttribute("data-revealed", "false");
  });
});

describe("armed threads", () => {
  const connectors = [
    { id: "t-top", x: 0.5, y: 0 },
    { id: "t-bottom", x: 0.5, y: 1 },
  ];

  it("should reveal the dots of an unselected node while a thread is armed", () => {
    render(
      <ReactFlowProvider>
        <NodeConnectors nodeId="armed-node" connectors={connectors} armed />
      </ReactFlowProvider>,
    );

    expect(screen.getByTestId("node-connectors")).toHaveAttribute("data-revealed", "true");
  });

  it("should reveal every node while the shared thread store is armed", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());
    expect(isRevealed(container, NOTE_ID)).toBe(false);

    act(() =>
      useLinkThreadStore
        .getState()
        .arm({ kind: "card", id: NOTE_ID, connectorId: "some-connector" }, "gesture"),
    );

    await waitFor(() => expect(isRevealed(container, PORTAL_ID)).toBe(true));
    expect(isRevealed(container, SKETCH_ID)).toBe(true);

    act(() => useLinkThreadStore.getState().clear());
    await waitFor(() => expect(isRevealed(container, PORTAL_ID)).toBe(false));
  });
});

describe("link drop targets", () => {
  it("should point a connection released on a portal at the board it opens", async () => {
    const portalTarget = workspace.createBoard({ name: "Drop target board" }).id;
    const note = workspace.createCard({
      id: "note-for-drop",
      typeId: "note",
      boardId,
      position: { x: 0, y: 4800 },
    });
    workspace.createPortalCard({
      id: "portal-for-drop",
      boardId,
      targetBoardId: portalTarget,
      position: { x: 400, y: 4800 },
    });
    mount();
    await waitFor(() => expect(flowApi).not.toBeNull());

    act(() => {
      flowApi?.getState().onConnect?.({
        source: note.id,
        target: "portal-for-drop",
        sourceHandle: null,
        targetHandle: null,
      });
    });

    // The portal stands in for its board: the link names the board, not the card.
    const [edge] = workspace.listLinksTo("board", portalTarget);
    expect(edge).toBeDefined();
    expect(edge?.targetKind).toBe("board");
    expect(edge?.target).toBe(portalTarget);
    expect(workspace.listLinksTo("card", "portal-for-drop")).toHaveLength(0);
  });

  it("should point a connection released over a section at the section", async () => {
    const section = workspace.createSection({
      boardId,
      title: "Drop band",
      x: 0,
      y: 5400,
      width: 400,
      height: 240,
    });
    const note = workspace.createCard({
      id: "note-for-section-drop",
      typeId: "note",
      boardId,
      position: { x: 500, y: 5400 },
    });
    mount();
    await waitFor(() => expect(flowApi).not.toBeNull());

    // The drag starts on the note's connector, then the pointer is released over
    // the bare section: React Flow never snapped to a handle, so the canvas
    // resolves the target geometrically.
    act(() => {
      flowApi?.getState().onConnectStart?.(new MouseEvent("mousedown"), {
        nodeId: note.id,
        handleId: note.connectors[0]?.id ?? null,
        handleType: "source",
      });
    });
    act(() => {
      flowApi?.getState().onConnectEnd?.(new MouseEvent("mouseup"), {
        pointer: { x: section.x + 40, y: section.y + 40 },
      } as never);
    });

    const [edge] = workspace.listLinksTo("section", section.id);
    expect(edge).toBeDefined();
    expect(edge?.targetKind).toBe("section");
    expect(edge?.source).toBe(note.id);
  });
});
