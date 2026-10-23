import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasZoomControls } from "./CanvasZoomControls";

function mount(overrides: Partial<Parameters<typeof CanvasZoomControls>[0]> = {}) {
  const handlers = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitView: vi.fn(),
    onGraphView: vi.fn(),
  };
  render(<CanvasZoomControls zoom={1} {...handlers} {...overrides} />);
  return handlers;
}

describe("CanvasZoomControls", () => {
  it("should render the zoom cluster as a labelled toolbar", () => {
    mount();
    const toolbar = screen.getByTestId("canvas-controls");
    expect(toolbar).toHaveAttribute("role", "toolbar");
    expect(toolbar).toHaveAttribute("aria-label", "Canvas zoom");
    expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
  });

  it("should report each camera action once", () => {
    const handlers = mount();
    fireEvent.click(screen.getByTestId("canvas-zoom-in"));
    fireEvent.click(screen.getByTestId("canvas-zoom-out"));
    fireEvent.click(screen.getByTestId("canvas-zoom-fit"));
    fireEvent.click(screen.getByTestId("canvas-graph-view"));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onFitView).toHaveBeenCalledTimes(1);
    expect(handlers.onGraphView).toHaveBeenCalledTimes(1);
  });

  it("should show the zoom as a percentage and never invent one", () => {
    const { rerender } = render(
      <CanvasZoomControls
        zoom={0.421}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFitView={vi.fn()}
        onGraphView={vi.fn()}
      />,
    );
    expect(screen.getByTestId("canvas-zoom-label")).toHaveTextContent("42%");

    // A camera that has not resolved yet reads 100%, not NaN or 0%.
    rerender(
      <CanvasZoomControls
        zoom={Number.NaN}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onFitView={vi.fn()}
        onGraphView={vi.fn()}
      />,
    );
    expect(screen.getByTestId("canvas-zoom-label")).toHaveTextContent("100%");
  });

  it("should offer the way back while the graph band is active", () => {
    mount({ graphActive: true });
    const graph = screen.getByTestId("canvas-graph-view");
    expect(graph).toHaveAttribute("aria-label", "Exit graph");
    expect(graph).toHaveAttribute("aria-pressed", "true");
    expect(graph).toHaveAttribute("data-graph-active", "true");
  });

  it("should hide the graph control when there is nothing to graph", () => {
    mount({ canGraphView: false });
    expect(screen.queryByTestId("canvas-graph-view")).toBeNull();
    // The rest of the cluster is untouched.
    expect(screen.getByTestId("canvas-zoom-in")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-zoom-fit")).toBeInTheDocument();
  });
});
