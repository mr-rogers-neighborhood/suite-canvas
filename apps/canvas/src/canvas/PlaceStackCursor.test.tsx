import { act, cleanup, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { PlaceStackCursor } from "./PlaceStackCursor";
import { usePlaceStackStore } from "./placeStack";

/**
 * The placement macro, one press at a time.
 *
 * A stack of three cards dropped in `thread` must write exactly two links (A→B, B→C);
 * one dropped in `fan` must write two spokes from one hub. The bug this pins down was a
 * third press writing two links, which only a real document and real presses show.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const workspace = useCanvasStore.getState().workspace;
let boardId = "";
const cardIds: string[] = [];

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  boardId = workspace.ensureBoard().id;
  for (let index = 0; index < 3; index += 1) {
    cardIds.push(workspace.createCard({ typeId: "note" }).id);
  }
  useUiStore.setState({
    activeBoardId: boardId,
    readOnly: false,
    canEditContent: true,
    canEditLayout: true,
    canManageTrash: true,
    selectedNodeIds: [],
  });
});

afterEach(() => {
  cleanup();
  usePlaceStackStore.getState().stop();
  for (const edge of workspace.listEdges()) workspace.removeEdge(edge.id);
  for (const id of cardIds) workspace.unplaceCard(boardId, id);
});

function board() {
  const surface = document.createElement("div");
  surface.dataset.testid = "canvas-board";
  document.body.append(surface);
  render(
    <ReactFlowProvider>
      <div data-testid="canvas-board" />
      <PlaceStackCursor />
    </ReactFlowProvider>,
  );
  return () => surface.remove();
}

/** One press on empty canvas, at a distinct flow position. */
function press(x: number, y: number) {
  const target = document.querySelector('[data-testid="canvas-board"]');
  if (!target) throw new Error("no board");
  const event = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

const edges = () => workspace.listBoardEdges(boardId);

describe("the stack's placement macro", () => {
  it("threads two links through three cards, one press each", () => {
    act(() => useUiStore.setState({ mode: "thread" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 100);
    press(400, 100);
    press(700, 100);

    const drawn = edges();
    expect(drawn).toHaveLength(2);
    const [first, second] = cardIds as [string, string, string];
    expect(drawn.map((edge) => `${edge.source}>${edge.target}`).sort()).toEqual(
      [`${first}>${second}`, `${second}>${thirdOf()}`].sort(),
    );
    cleanupSurface();
  });

  it("fans two spokes from the first card placed", () => {
    act(() => useUiStore.setState({ mode: "fan" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 300);
    press(400, 300);
    press(700, 300);

    const drawn = edges();
    expect(drawn).toHaveLength(2);
    const hub = cardIds[0];
    expect(drawn.every((edge) => edge.source === hub)).toBe(true);
    cleanupSurface();
  });

  it("does not bring a link back when the cards are placed again", () => {
    // The bug the reader hit: thread a stack, take the cards off the board, then fan the
    // same three cards. The old A→B line was still in the document, so re-placing both
    // ends drew it again and the fan looked like it had linked the third card twice.
    act(() => useUiStore.setState({ mode: "thread" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 700);
    press(400, 700);
    press(700, 700);
    expect(edges()).toHaveLength(2);

    for (const id of cardIds) workspace.unplaceCard(boardId, id);
    expect(workspace.listEdges()).toHaveLength(0);

    act(() => useUiStore.setState({ mode: "fan" }));
    act(() => usePlaceStackStore.getState().start(cardIds));
    press(100, 900);
    press(400, 900);
    press(700, 900);

    const drawn = edges();
    expect(drawn).toHaveLength(2);
    const hub = cardIds[0];
    expect(drawn.every((edge) => edge.source === hub)).toBe(true);
    cleanupSurface();
  });

  it("draws nothing in place mode", () => {
    act(() => useUiStore.setState({ mode: "place" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 500);
    press(400, 500);

    expect(edges()).toHaveLength(0);
    cleanupSurface();
  });
});

function thirdOf(): string {
  return cardIds[2] as string;
}
