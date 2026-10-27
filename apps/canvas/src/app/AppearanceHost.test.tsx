import { WorkspaceDocument } from "@suite/graph";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { AppearanceHost } from "./AppearanceHost";

/**
 * The right-click panel is the inspector's Style tab, on the board.
 *
 * The properties worth pinning: it opens where the reader is, it writes the same
 * record the panel writes, and closing it leaves the document alone.
 */

beforeEach(() => {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Home" });
  doc.createCard({ id: "card-1", boardId: board.id, position: { x: 0, y: 0 } });
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({ appearanceTarget: null, canEditLayout: true });
});

function open() {
  act(() =>
    useUiStore.getState().openAppearance({ kind: "card", id: "card-1", at: { x: 100, y: 100 } }),
  );
}

describe("the appearance panel", () => {
  it("renders nothing until a surface asks for it", () => {
    render(<AppearanceHost />);
    expect(screen.queryByTestId("appearance-panel")).toBeNull();
  });

  it("mounts the same editor and writes the card's own style", () => {
    render(<AppearanceHost />);
    open();

    expect(screen.getByTestId("appearance-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("style-swatch-amber"));

    const doc = useCanvasStore.getState().workspace;
    expect(doc.getCard("card-1")?.style?.swatch).toBe("amber");
  });

  it("says what the card inherits from its type", () => {
    const doc = useCanvasStore.getState().workspace;
    const typeId = doc.getCard("card-1")?.primaryTypeId ?? "";
    doc.updateType(typeId, { style: { shape: "pill" } });

    render(<AppearanceHost />);
    open();

    expect(screen.getByTestId("style-inherits")).toHaveTextContent("wears");
  });

  it("offers a way to the palette a colour is missing from", () => {
    render(<AppearanceHost />);
    open();

    expect(screen.getByTestId("appearance-edit-palette")).toHaveTextContent("Edit palette");
  });

  it("closes without touching the document", () => {
    render(<AppearanceHost />);
    open();
    const before = JSON.stringify(useCanvasStore.getState().workspace.getCard("card-1"));

    fireEvent.click(screen.getByTestId("appearance-close"));

    expect(screen.queryByTestId("appearance-panel")).toBeNull();
    expect(JSON.stringify(useCanvasStore.getState().workspace.getCard("card-1"))).toBe(before);
  });
});
