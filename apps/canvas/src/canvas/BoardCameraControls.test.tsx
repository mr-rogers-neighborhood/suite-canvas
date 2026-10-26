import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardCameraControls } from "./BoardCameraControls";
import { useCameraPrefs } from "./cameraPrefs";

/**
 * The camera controls a canvas is expected to have: a zoom readout, zoom to the
 * selection, the outline toggle and the grid toggle. They ride React Flow's own
 * `<Controls>` stack so they move and focus like the built-in buttons.
 */

function mount(over: { hasSelection?: boolean; outlineOpen?: boolean } = {}) {
  const onZoomToSelection = vi.fn();
  const onToggleOutline = vi.fn();
  render(
    <ReactFlowProvider>
      <BoardCameraControls
        hasSelection={over.hasSelection ?? false}
        onZoomToSelection={onZoomToSelection}
        outlineOpen={over.outlineOpen ?? true}
        onToggleOutline={onToggleOutline}
      />
    </ReactFlowProvider>,
  );
  return { onZoomToSelection, onToggleOutline };
}

beforeEach(() => {
  useCameraPrefs.setState({ gridVisible: true });
});

describe("camera controls", () => {
  it("reads the zoom out as a percentage", () => {
    mount();

    expect(screen.getByTestId("zoom-readout")).toHaveTextContent("100%");
    expect(screen.getByTestId("zoom-readout")).toHaveAccessibleName(
      "Zoom 100 percent. Reset to 100 percent.",
    );
  });

  it("only offers zoom-to-selection when something is selected", () => {
    const { onZoomToSelection } = mount({ hasSelection: true });

    const button = screen.getByTestId("zoom-to-selection");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onZoomToSelection).toHaveBeenCalledOnce();
  });

  it("disables zoom-to-selection on an empty board", () => {
    mount({ hasSelection: false });

    expect(screen.getByTestId("zoom-to-selection")).toBeDisabled();
  });

  it("toggles the outline and reports whether it is open", () => {
    const { onToggleOutline } = mount({ outlineOpen: false });

    const button = screen.getByTestId("outline-control");
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(onToggleOutline).toHaveBeenCalledOnce();
  });

  it("toggles the dot grid preference", () => {
    mount();

    fireEvent.click(screen.getByTestId("grid-control"));

    expect(useCameraPrefs.getState().gridVisible).toBe(false);
    expect(screen.getByTestId("grid-control")).toHaveAttribute("aria-pressed", "false");
  });
});
