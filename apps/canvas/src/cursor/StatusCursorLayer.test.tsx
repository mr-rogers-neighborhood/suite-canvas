import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PeerPresence } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useUiStore } from "../store/useUiStore";
import { StatusCursorLayer } from "./StatusCursorLayer";

/**
 * The status cursor is peers-only
 * (ADR-0064 amendment).
 *
 * The reader's own bubble repeated what the pill already says, permanently, under the
 * pointer. What must survive the removal is the part that was not decoration: the peers,
 * and the ones who are off this view at all.
 */
function peer(overrides: Partial<PeerPresence> = {}): PeerPresence {
  return {
    clientId: "peer-1",
    board: "board-1",
    user: { name: "Ada", color: "#3b82f6" },
    pointer: { x: 100, y: 100 },
    focus: null,
    dragging: null,
    selection: null,
    selectionBox: null,
    connector: null,
    resizing: null,
    sectionDrag: null,
    sectionResize: null,
    reconnect: null,
    connect: null,
    labelDrag: null,
    purpose: "record",
    gesture: "thread",
    ...overrides,
  } as PeerPresence;
}

/** A bare provider: no pane, so `domNode` is null and no edge can be measured. */
function renderLayer() {
  return render(
    <ReactFlowProvider>
      <div data-testid="flow-host" style={{ position: "relative" }}>
        <StatusCursorLayer />
      </div>
    </ReactFlowProvider>,
  );
}

// React Flow measures its pane, and jsdom has neither layout nor ResizeObserver. The
// canvas tests stub both the same way; here it is what makes an edge measurable at all.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const originalRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    }) as DOMRect;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

/** A pane, so the layer has bounds to clamp a tick against. */
function renderWithPane() {
  return render(
    <ReactFlowProvider>
      <div style={{ width: 1024, height: 768 }}>
        <ReactFlow nodes={[]} edges={[]}>
          <StatusCursorLayer />
        </ReactFlow>
      </div>
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  useUiStore.setState({
    readOnly: false,
    activeBoardId: "board-1",
    purpose: "record",
    mode: "thread",
  });
  usePresenceStore.setState({ peers: {} });
});

describe("StatusCursorLayer", () => {
  it("does not draw a bubble for the reader whose canvas it is", () => {
    renderLayer();

    // The pill states both axes already, permanently and in the same colours, so a ring
    // repeating them under the pointer is the same sentence twice.
    expect(screen.queryAllByTestId("status-cursor")).toHaveLength(0);
    expect(document.querySelector('[data-self="true"]')).toBeNull();
  });

  it("still draws a peer's bubble when their pointer is on this board", () => {
    usePresenceStore.setState({ peers: { "peer-1": peer() } });

    renderLayer();

    const bubble = document.querySelector('[data-testid="status-cursor"]');
    expect(bubble).not.toBeNull();
    // Peers are the whole reason this layer exists now.
    expect(bubble).toHaveAttribute("data-self", "false");
    expect(document.querySelector(".status-cursor-anchor")).not.toBeNull();
  });

  it("stays quiet for a peer who is in the resting state", () => {
    usePresenceStore.setState({
      peers: { "peer-1": peer({ purpose: "explore", gesture: "place" }) },
    });

    renderLayer();

    // Their arrow and name chip already answer "where are they"; a bubble that says
    // "nothing in particular" is noise.
    expect(document.querySelector('[data-testid="status-cursor"]')).toBeNull();
  });

  it("points at a peer who is off this view instead of dropping them", () => {
    usePresenceStore.setState({
      peers: { "peer-1": peer({ pointer: { x: 40_000, y: 40_000 } }) },
    });

    renderWithPane();

    const tick = screen.getByTestId("peer-edge-tick");
    // A name, not just a colour: the tick has to answer "who", and its direction answers
    // "where they went".
    expect(tick).toHaveAttribute("aria-label", "Bring Ada into view");
    expect(tick).toHaveAttribute("data-peer-name", "Ada");
    // No bubble for them: there is nowhere on the glass to draw one.
    expect(document.querySelector('[data-testid="status-cursor"]')).toBeNull();

    // Clamped inside the pane rather than hanging off the corner.
    const left = Number.parseFloat(tick.style.left);
    const top = Number.parseFloat(tick.style.top);
    expect(left).toBeLessThanOrEqual(1024 - 18);
    expect(top).toBeLessThanOrEqual(768 - 18);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);

    // Pressing it is the whole affordance: bring them into view.
    fireEvent.click(tick);
    expect(screen.getByTestId("peer-edge-tick")).toBeInTheDocument();
  });

  it("draws nothing at all when the workspace is read-only", () => {
    useUiStore.setState({ readOnly: true });
    usePresenceStore.setState({ peers: { "peer-1": peer() } });

    renderLayer();

    expect(document.querySelector('[data-testid="status-cursor"]')).toBeNull();
    expect(screen.queryByTestId("peer-edge-tick")).toBeNull();
  });
});
