import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlacementRunStore } from "./placementRun";
import type { PlacementEngine } from "./usePlacementEngine";

/**
 * The press that puts a held card down.
 *
 * The board rebuilds `PlacementEngine` on every render. The `pointerdown`
 * listener must survive that: it carried `engine` in its dependency list, so every
 * render removed and re-added the handler, and a trusted click that straddled a
 * render placed nothing. The count stayed at "4 left" while a dispatched
 * `pointerdown` worked, which made it look like a test problem rather than a
 * product one.
 *
 * The property worth pinning is listener stability, because that is what was
 * wrong. A test that only dispatched events would pass either way, since the torn
 * down listener is re-added before the next event can arrive.
 */

/** A board pane the press has to land inside. */
function mountBoard(): HTMLElement {
  const board = document.createElement("div");
  board.dataset.testid = "canvas-board";
  document.body.append(board);
  return board;
}

function engine(overrides: Partial<PlacementEngine> = {}): PlacementEngine {
  return {
    step: vi.fn(),
    placeAt: vi.fn(),
    held: "card-1",
    proposeAt: vi.fn(() => null),
    ...overrides,
  } as PlacementEngine;
}

/** React Flow's own hook, stood in for: screen and flow space are the same here. */
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => point }),
}));

const { HeldStackCursor } = await import("./HeldStackCursor");

afterEach(() => {
  document.body.innerHTML = "";
  usePlacementRunStore.setState({ run: null, proposal: null, suspended: [] });
  vi.restoreAllMocks();
});

function countOf(spy: { mock: { calls: unknown[][] } }, type: string): number {
  return spy.mock.calls.filter((call) => call[0] === type).length;
}

describe("a held stack", () => {
  it("keeps one press listener while the engine is rebuilt", () => {
    mountBoard();
    usePlacementRunStore.getState().start(["card-1", "card-2"]);

    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const { rerender } = render(<HeldStackCursor engine={engine()} />);
    const afterFirst = countOf(add, "pointerdown");

    // The board renders again, as it does on every proposal.
    rerender(<HeldStackCursor engine={engine()} />);
    rerender(<HeldStackCursor engine={engine()} />);

    expect(countOf(add, "pointerdown")).toBe(afterFirst);
    expect(countOf(remove, "pointerdown"), "the press listener was torn down by a re-render").toBe(
      0,
    );
  });

  it("places at the press through the current engine", () => {
    const board = mountBoard();
    usePlacementRunStore.getState().start(["card-1", "card-2"]);

    const first = engine();
    const { rerender } = render(<HeldStackCursor engine={first} />);
    const second = engine();
    rerender(<HeldStackCursor engine={second} />);

    board.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 120,
        clientY: 90,
      }),
    );

    expect(second.placeAt).toHaveBeenCalledWith({ x: 120, y: 90 });
    expect(first.placeAt).not.toHaveBeenCalled();
  });

  it("places inside a section, whose hit area is a button because it is focusable", () => {
    // The section frame is a `<button>`: its hit area is the whole section, not chrome.
    // Treating it as a control swallowed every press aimed inside it, which is where a
    // board keeps most of its cards, so a run looked broken exactly where it was used.
    const board = mountBoard();
    const frame = document.createElement("button");
    frame.type = "button";
    frame.className = "section-region";
    board.append(frame);
    usePlacementRunStore.getState().start(["card-1", "card-2"], { shape: "fan" });
    const placed = vi.fn();
    render(<HeldStackCursor engine={engine({ placeAt: placed })} />);

    frame.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(placed).toHaveBeenCalledTimes(1);
  });

  it("still leaves a real control its own press", () => {
    const board = mountBoard();
    const control = document.createElement("button");
    control.type = "button";
    board.append(control);
    usePlacementRunStore.getState().start(["card-1", "card-2"], { shape: "fan" });
    const placed = vi.fn();
    render(<HeldStackCursor engine={engine({ placeAt: placed })} />);

    control.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(placed).not.toHaveBeenCalled();
  });

  it("does not place when nothing is in hand", () => {
    const board = mountBoard();
    const placed = engine();
    render(<HeldStackCursor engine={placed} />);

    board.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 8,
        clientY: 8,
      }),
    );

    expect(placed.placeAt).not.toHaveBeenCalled();
  });
});
