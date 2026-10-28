import { act, cleanup, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { undoWithStack } from "../history/undoWithStack";
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

  it("continues from the last card placed when the mode changes", () => {
    // The reader's rule: switch modes mid-stack and the next link starts at the card you
    // just put down, whichever mode drew the line before it.
    act(() => useUiStore.setState({ mode: "fan" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 1100);
    press(400, 1100);
    // Fan: both spokes leave the hub, and the second press is the last card placed.
    act(() => useUiStore.setState({ mode: "thread" }));
    press(700, 1100);

    const drawn = edges();
    const [first, second, third] = cardIds as [string, string, string];
    // The fan linked the hub to the second card; the switch to thread carries on from
    // *that* card, so the third link starts at the card just placed, not at the hub.
    expect(drawn.map((edge) => `${edge.source}>${edge.target}`).sort()).toEqual(
      [`${first}>${second}`, `${second}>${third}`].sort(),
    );
    cleanupSurface();
  });

  it("lights the two dots a placement linked through", () => {
    act(() => useUiStore.setState({ mode: "thread" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 1300);
    press(400, 1300);

    const flash = usePlaceStackStore.getState().flash;
    expect(flash).toHaveLength(2);
    expect(new Set(flash.map((entry) => entry.nodeId))).toEqual(new Set(cardIds.slice(0, 2)));
    expect(flash.every((entry) => entry.connectorId.length > 0)).toBe(true);
    cleanupSurface();
  });

  it("keeps the anchor when the cycle passes through place", () => {
    // Cycling fan → place → thread is one decision by the reader, so the anchor survives
    // the pass-through and the next link still starts at the card they placed last.
    act(() => useUiStore.setState({ mode: "fan" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 1500);
    press(400, 1500);
    act(() => useUiStore.setState({ mode: "place" }));
    act(() => useUiStore.setState({ mode: "thread" }));
    press(700, 1500);

    const [first, second, third] = cardIds as [string, string, string];
    expect(
      edges()
        .map((edge) => `${edge.source}>${edge.target}`)
        .sort(),
    ).toEqual([`${first}>${second}`, `${second}>${third}`].sort());
    cleanupSurface();
  });

  it("undoes the placement and its link as one step", () => {
    act(() => useUiStore.setState({ mode: "thread" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 900);
    press(400, 900);
    expect(edges()).toHaveLength(1);
    expect(workspace.getPlacement(boardId, cardIds[1] as string)).toBeDefined();

    // One press is one change: the link does not survive its placement's undo, and the
    // placement does not need a second press to leave.
    act(() => undoWithStack(workspace));

    expect(edges()).toHaveLength(0);
    expect(workspace.getPlacement(boardId, cardIds[1] as string)).toBeUndefined();
    expect(workspace.getPlacement(boardId, cardIds[0] as string)).toBeDefined();
    cleanupSurface();
  });

  it("re-threads from what is still on the board after an undo", () => {
    act(() => useUiStore.setState({ mode: "thread" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 1000);
    press(400, 1000);
    act(() => undoWithStack(workspace));

    // The hand is whole again and the anchor is the card still on the board, so the next
    // press draws a line instead of quietly linking to a card that is no longer there.
    press(700, 1000);

    const [first, second] = cardIds as [string, string, string];
    expect(edges().map((edge) => `${edge.source}>${edge.target}`)).toEqual([`${first}>${second}`]);
    cleanupSurface();
  });

  it("hands a card back when its placement is undone", () => {
    act(() => useUiStore.setState({ mode: "place" }));
    const cleanupSurface = board();
    act(() => usePlaceStackStore.getState().start(cardIds));

    press(100, 1700);
    press(400, 1700);
    const stack = usePlaceStackStore.getState();
    expect(stack.queue).toHaveLength(1);
    expect(stack.placed).toHaveLength(2);

    // One press is one undo step, so a single undo takes the placement (and its link).
    act(() => undoWithStack(workspace));

    // The card is off the board, so it goes back into the hand rather than the inbox.
    const after = usePlaceStackStore.getState();
    expect(after.queue).toHaveLength(2);
    expect(after.placed).toHaveLength(1);
    expect(after.queue[0]).toBe(cardIds[1]);
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
