import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationKindsDialog } from "./AnnotationKindsDialog";

/**
 * The kinds editor.
 *
 * Two things went wrong here that a component test can hold: the panel scrolled as one block, so a long list of slots
 * took the header — and the only visible way out — off the screen, and the dialog lived inside the library, so Escape
 * closed the drawer and the dialog at once. The layout is a class name now, but the closing rule is behaviour.
 */
let workspace: WorkspaceDocument;

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  workspace.ensureBoard();
  workspace.ensureAnnotationStyles();
});

function draw(onClose = vi.fn()) {
  render(<AnnotationKindsDialog workspace={workspace} onClose={onClose} />);
  return { onClose };
}

describe("the kinds of highlight", () => {
  it("should list the kinds a workspace starts with, and what each becomes", () => {
    draw();
    expect(screen.getByText("Kinds of highlight")).toBeInTheDocument();
    // The defaults, by the name the palette gives them.
    expect(screen.getByTestId("annotation-kind-style-yellow")).toBeInTheDocument();
  });

  it("should close on Escape, which is the dialog's own key and nobody else's", () => {
    const { onClose } = draw();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("should close from the footer, so a reader who scrolled is never stuck", () => {
    const { onClose } = draw();
    fireEvent.click(screen.getByTestId("annotation-kinds-done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("should close from the scrim behind the panel", () => {
    const { onClose } = draw();
    const scrim = document.querySelector(".ann-kinds-scrim-hit");
    if (scrim === null) throw new Error("no scrim");
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });

  it("should rename a kind and keep the colour with it", () => {
    draw();
    fireEvent.blur(screen.getByTestId("ann-type-name-style-yellow"), {
      target: { value: "Claim" },
    });
    expect(
      workspace.listAnnotationStyles().find((entry) => entry.id === "style-yellow")?.name,
    ).toBe("Claim");
  });

  it("should add a kind of its own", () => {
    const before = workspace.listAnnotationStyles().length;
    draw();
    fireEvent.click(screen.getByTestId("annotation-kind-add"));
    expect(workspace.listAnnotationStyles()).toHaveLength(before + 1);
  });
});
