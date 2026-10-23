import { WorkspaceDocument } from "@suite/graph";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PinsPanel } from "./PinsPanel";

/** Two boards and one pin on each: enough to prove grouping and order. */
function fixture() {
  const workspace = new WorkspaceDocument();
  const home = workspace.ensureBoard();
  const drafts = workspace.createBoard({ name: "Drafts" });
  const homePin = workspace.createPin({
    id: "pin-home",
    boardId: home.id,
    x: 10,
    y: 20,
    label: "Grading notes",
    createdBy: "test",
  });
  const draftPin = workspace.createPin({
    id: "pin-drafts",
    boardId: drafts.id,
    x: 0,
    y: 0,
    label: "Chapter 3",
    color: "blue",
    createdBy: "test",
    target: { kind: "card", id: "card-1" },
  });
  return { workspace, home, drafts, homePin, draftPin };
}

describe("PinsPanel", () => {
  it("should group pins by board with the active board first", () => {
    const { workspace, home, drafts, homePin, draftPin } = fixture();
    render(
      <PinsPanel workspace={workspace} activeBoardId={drafts.id} onFocusPin={vi.fn()} canManage />,
    );

    const groups = screen.getAllByTestId(/^pins-group-/);
    expect(groups.map((group) => group.getAttribute("data-testid"))).toEqual([
      `pins-group-${drafts.id}`,
      `pins-group-${home.id}`,
    ]);
    expect(groups[0]).toHaveAttribute("data-active", "true");
    expect(groups[1]).not.toHaveAttribute("data-active");

    expect(screen.getByText("Chapter 3")).toBeInTheDocument();
    expect(screen.getByText("Grading notes")).toBeInTheDocument();
    expect(screen.getByTestId(`pin-row-${homePin.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pin-row-${draftPin.id}`)).toBeInTheDocument();
    // The colour swatch and the optional target kind ride the row.
    expect(screen.getByTestId(`pin-swatch-${draftPin.id}`)).toHaveAttribute("data-color", "blue");
    expect(screen.getByTestId(`pin-target-${draftPin.id}`)).toHaveTextContent("card");
    expect(screen.queryByTestId(`pin-target-${homePin.id}`)).toBeNull();
  });

  it("should focus a pin without writing to it", () => {
    const { workspace, homePin } = fixture();
    const onFocusPin = vi.fn();
    render(
      <PinsPanel workspace={workspace} activeBoardId={null} onFocusPin={onFocusPin} canManage />,
    );

    fireEvent.click(screen.getByTestId(`pin-focus-${homePin.id}`));
    expect(onFocusPin).toHaveBeenCalledWith(homePin);
    expect(workspace.getPin(homePin.id)).toEqual(homePin);
  });

  it("should commit a rename on Enter", () => {
    const { workspace, homePin } = fixture();
    render(<PinsPanel workspace={workspace} activeBoardId={null} onFocusPin={vi.fn()} canManage />);

    fireEvent.click(screen.getByTestId(`pin-rename-${homePin.id}`));
    const input = screen.getByTestId(`pin-rename-input-${homePin.id}`);
    expect(input).toHaveValue("Grading notes");

    fireEvent.change(input, { target: { value: "Marked place" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(workspace.getPin(homePin.id)?.label).toBe("Marked place");
    expect(screen.queryByTestId(`pin-rename-input-${homePin.id}`)).toBeNull();
    expect(screen.getByText("Marked place")).toBeInTheDocument();
  });

  it("should commit a rename on blur and abandon an empty one", () => {
    const { workspace, homePin } = fixture();
    render(<PinsPanel workspace={workspace} activeBoardId={null} onFocusPin={vi.fn()} canManage />);

    fireEvent.click(screen.getByTestId(`pin-rename-${homePin.id}`));
    const input = screen.getByTestId(`pin-rename-input-${homePin.id}`);
    fireEvent.change(input, { target: { value: "  Second look  " } });
    fireEvent.blur(input);
    expect(workspace.getPin(homePin.id)?.label).toBe("Second look");

    fireEvent.click(screen.getByTestId(`pin-rename-${homePin.id}`));
    const again = screen.getByTestId(`pin-rename-input-${homePin.id}`);
    fireEvent.change(again, { target: { value: "   " } });
    fireEvent.blur(again);
    expect(workspace.getPin(homePin.id)?.label).toBe("Second look");
  });

  it("should cancel a rename on Escape and keep the stored label", () => {
    const { workspace, homePin } = fixture();
    render(<PinsPanel workspace={workspace} activeBoardId={null} onFocusPin={vi.fn()} canManage />);

    fireEvent.click(screen.getByTestId(`pin-rename-${homePin.id}`));
    const input = screen.getByTestId(`pin-rename-input-${homePin.id}`);
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    // A blur that follows the unmount must not commit the abandoned text.
    fireEvent.blur(input);

    expect(workspace.getPin(homePin.id)?.label).toBe("Grading notes");
    expect(screen.queryByTestId(`pin-rename-input-${homePin.id}`)).toBeNull();
    expect(screen.getByText("Grading notes")).toBeInTheDocument();
  });

  it("should confirm a delete inline, then remove the marker", () => {
    const { workspace, homePin } = fixture();
    render(<PinsPanel workspace={workspace} activeBoardId={null} onFocusPin={vi.fn()} canManage />);

    fireEvent.click(screen.getByTestId(`pin-delete-${homePin.id}`));
    expect(screen.getByTestId(`pin-delete-confirm-${homePin.id}`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(workspace.getPin(homePin.id)).toBeDefined();

    fireEvent.click(screen.getByTestId(`pin-delete-cancel-${homePin.id}`));
    expect(workspace.getPin(homePin.id)).toBeDefined();

    fireEvent.click(screen.getByTestId(`pin-delete-${homePin.id}`));
    fireEvent.click(screen.getByTestId(`pin-delete-confirm-${homePin.id}`));

    expect(workspace.getPin(homePin.id)).toBeUndefined();
    expect(screen.queryByTestId(`pin-row-${homePin.id}`)).toBeNull();
  });

  it("should hide rename and delete when the session cannot manage pins", () => {
    const { workspace, homePin } = fixture();
    render(
      <PinsPanel
        workspace={workspace}
        activeBoardId={null}
        onFocusPin={vi.fn()}
        canManage={false}
      />,
    );

    expect(screen.getByTestId(`pin-row-${homePin.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pin-focus-${homePin.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`pin-rename-${homePin.id}`)).toBeNull();
    expect(screen.queryByTestId(`pin-delete-${homePin.id}`)).toBeNull();
  });

  it("should render the empty state for a null workspace and an empty document", () => {
    render(<PinsPanel workspace={null} activeBoardId="board-1" onFocusPin={vi.fn()} canManage />);
    expect(screen.getByTestId("pins-empty")).toHaveTextContent("Drop one on the canvas");

    cleanup();
    render(
      <PinsPanel
        workspace={new WorkspaceDocument()}
        activeBoardId={null}
        onFocusPin={vi.fn()}
        canManage
      />,
    );
    expect(screen.getByTestId("pins-empty")).toBeInTheDocument();
  });

  it("should repaint when a pin lands in the document", () => {
    const { workspace } = fixture();
    render(<PinsPanel workspace={workspace} activeBoardId={null} onFocusPin={vi.fn()} canManage />);
    expect(screen.queryByTestId("pin-row-pin-new")).toBeNull();

    act(() => {
      workspace.createPin({
        id: "pin-new",
        boardId: workspace.ensureBoard().id,
        x: 4,
        y: 8,
        label: "Fresh mark",
        createdBy: "test",
      });
    });

    expect(screen.getByTestId("pin-row-pin-new")).toBeInTheDocument();
    expect(screen.getByText("Fresh mark")).toBeInTheDocument();
  });
});
