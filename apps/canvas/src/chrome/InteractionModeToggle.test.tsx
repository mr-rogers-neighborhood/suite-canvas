import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { InteractionModeToggle } from "./InteractionModeToggle";

/**
 * Reading a board and editing it are the same click, so the mode has to be legible: the
 * control names what a press currently does, not what it would switch to.
 */
describe("the interaction mode toggle", () => {
  beforeEach(() => {
    useUiStore.setState({ interactionMode: "inspect" });
  });

  it("should start on the default and say what a click does", () => {
    render(<InteractionModeToggle />);
    const control = screen.getByTestId("interaction-mode");
    expect(control).toHaveAttribute("data-mode", "inspect");
    expect(control).toHaveAccessibleName("Clicking a card opens the inspector");
    expect(control).toHaveAttribute("aria-pressed", "false");
  });

  it("should walk inspect, quiet, locked and back", () => {
    render(<InteractionModeToggle />);
    const control = screen.getByTestId("interaction-mode");

    fireEvent.click(control);
    expect(useUiStore.getState().interactionMode).toBe("quiet");
    expect(control).toHaveAccessibleName("Clicking a card edits it without the inspector");
    expect(control).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(control);
    expect(useUiStore.getState().interactionMode).toBe("locked");
    expect(control).toHaveAccessibleName("Canvas locked: pan and zoom only");

    fireEvent.click(control);
    expect(useUiStore.getState().interactionMode).toBe("inspect");
  });

  it("should close the inspector it was showing when the mode stops opening it", () => {
    useUiStore.setState({ inspectorNodeId: "card-1", inspectorFieldId: null });
    render(<InteractionModeToggle />);

    fireEvent.click(screen.getByTestId("interaction-mode"));

    // "Clicking no longer opens the inspector" would be a claim about a panel still on
    // screen, so leaving `inspect` puts the drawer away.
    expect(useUiStore.getState().inspectorNodeId).toBeNull();
  });

  it("should drop the selection and the caret when the canvas is locked", () => {
    useUiStore.setState({
      inspectorNodeId: "card-1",
      selectedNodeIds: ["card-1"],
      editingNodeId: "card-1",
    });
    render(<InteractionModeToggle />);

    fireEvent.click(screen.getByTestId("interaction-mode"));
    fireEvent.click(screen.getByTestId("interaction-mode"));

    const state = useUiStore.getState();
    expect(state.interactionMode).toBe("locked");
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.editingNodeId).toBeNull();
  });
});
