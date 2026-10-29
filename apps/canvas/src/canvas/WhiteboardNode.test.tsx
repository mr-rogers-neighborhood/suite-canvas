import type { Card, Placement } from "@suite/graph";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureWhiteboardType } from "../cards/whiteboard";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import type { CardNodeData } from "./nodeData";
import { WhiteboardNode } from "./WhiteboardNode";

// React Flow measures its container; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const workspace = useCanvasStore.getState().workspace;
const sketchType = ensureWhiteboardType(workspace);
let card: Card;
let placement: Placement;

beforeAll(() => {
  const boardId = workspace.ensureBoard().id;
  card = workspace.createCard({
    id: "sketch-node-card",
    typeId: sketchType.id,
    boardId,
    position: { x: 0, y: 0 },
  });
  const stored = workspace.getPlacement(boardId, card.id);
  if (!stored) throw new Error("the sketch has no placement");
  placement = stored;
});

beforeEach(() => {
  cleanup();
  useUiStore.setState({
    inspectorNodeId: null,
    inspectorFieldId: null,
    cardFocusId: null,
    interactionMode: "inspect",
  });
  useCanvasStore.setState({ ready: true, synced: true });
});

function renderSketch() {
  // Only `data` and `selected` are read by the node; the rest of NodeProps is
  // React Flow bookkeeping that a standalone render does not need.
  const props = {
    id: card.id,
    data: {
      card,
      placement,
      type: sketchType,
      meta: { properties: [], tags: [] },
    } as CardNodeData,
    selected: false,
  } as unknown as NodeProps;
  render(
    <ReactFlowProvider>
      <WhiteboardNode {...props} />
    </ReactFlowProvider>,
  );
  return screen.getByTestId("whiteboard-node");
}

describe("WhiteboardNode", () => {
  it("opens the inspector on a click, the same drawer a note uses", () => {
    const node = renderSketch();
    fireEvent.pointerDown(node, { clientX: 100, clientY: 100 });
    fireEvent.click(node, { clientX: 100, clientY: 100 });
    expect(useUiStore.getState().inspectorNodeId).toBe(card.id);
  });

  it("does not read a drag as a click", () => {
    const node = renderSketch();
    fireEvent.pointerDown(node, { clientX: 100, clientY: 100 });
    // The pointer left the origin before the click landed: this was a drag.
    fireEvent.click(node, { clientX: 140, clientY: 130 });
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
  });

  it("leaves modifier clicks to the multi-selection", () => {
    const node = renderSketch();
    fireEvent.pointerDown(node, { clientX: 100, clientY: 100 });
    fireEvent.click(node, { clientX: 100, clientY: 100, shiftKey: true });
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
  });

  it("answers the menu bar's mode like a note does", () => {
    // The mode is read at render, so it is set before the sketch is drawn: a store write
    // after the fact would land outside an act() and test stale props instead.
    useUiStore.setState({ interactionMode: "locked" });
    const lockedNode = renderSketch();
    fireEvent.pointerDown(lockedNode, { clientX: 100, clientY: 100 });
    fireEvent.click(lockedNode, { clientX: 100, clientY: 100 });
    fireEvent.doubleClick(lockedNode);
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
    expect(useUiStore.getState().cardFocusId).toBeNull();
    cleanup();

    useUiStore.setState({ inspectorNodeId: null, cardFocusId: null, interactionMode: "quiet" });
    const quietNode = renderSketch();
    fireEvent.pointerDown(quietNode, { clientX: 100, clientY: 100 });
    fireEvent.click(quietNode, { clientX: 100, clientY: 100 });
    // Quiet shuts the drawer, not the card: the press still counts, it just opens nothing.
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
  });

  it("keeps the focus surface on the double click", () => {
    const node = renderSketch();
    fireEvent.doubleClick(screen.getByTestId("whiteboard-card-open"));
    expect(useUiStore.getState().cardFocusId).toBe(card.id);
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
    expect(node).toBeInTheDocument();
  });
});
