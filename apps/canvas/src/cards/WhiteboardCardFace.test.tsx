import type { Drawing } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhiteboardCardFace } from "./WhiteboardCardFace";

const drawing: Drawing = {
  cardId: "card-1",
  elements: [
    { id: "rect-1", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
    { id: "text-1", type: "text", x: 12, y: 12, width: 80, height: 16, text: "Hello" },
  ],
  order: ["rect-1", "text-1"],
  version: 1,
  updatedAt: 0,
};

describe("WhiteboardCardFace", () => {
  it("should show the preview, title and element count", () => {
    render(<WhiteboardCardFace drawing={drawing} label="Ideas" onOpen={() => {}} />);

    expect(screen.getByTestId("whiteboard-card")).toHaveTextContent("Ideas");
    expect(screen.getByTestId("whiteboard-preview")).toHaveAttribute("aria-label", "Ideas preview");
    expect(screen.getByTitle("2 elements")).toHaveTextContent("2");
  });

  it("should open the focus surface on a double click, not a single one", () => {
    const onOpen = vi.fn();
    render(<WhiteboardCardFace drawing={drawing} onOpen={onOpen} />);
    const preview = screen.getByTestId("whiteboard-card-open");

    // A single click belongs to selection; opening here would swallow the
    // shift-click that adds a sketch to a multi-selection.
    fireEvent.click(preview);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.doubleClick(preview);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("should open the focus surface from the keyboard", () => {
    const onOpen = vi.fn();
    render(<WhiteboardCardFace drawing={drawing} onOpen={onOpen} />);
    const preview = screen.getByTestId("whiteboard-card-open");

    fireEvent.keyDown(preview, { key: "Enter" });
    fireEvent.keyDown(preview, { key: " " });

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("should render an empty board without a drawing", () => {
    render(<WhiteboardCardFace drawing={null} onOpen={() => {}} />);
    expect(screen.getByTestId("whiteboard-preview")).toHaveAttribute("data-empty", "true");
  });
});
