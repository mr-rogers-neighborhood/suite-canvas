import type { GraphEdge } from "@suite/graph";
import { DEFAULT_PALETTE, WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { LinkInspector } from "./LinkInspector";
import type { LinkInspectorModel } from "./useLinkInspectorModel";

/**
 * A link's appearance, in the panel.
 *
 * The panel repeated what the right-click menu offered except the one thing the menu could not deliver: colour. A link's
 * colour lives on `sides.top` and its swatch on the style, and a writer that does not spread what is already there drops
 * the swatch — which is how a link turned blue after a change to something else.
 */
let workspace: WorkspaceDocument;
let edge: GraphEdge;

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const a = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const b = workspace.createCard({ boardId: board.id, position: { x: 200, y: 0 } });
  const made = workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });
  if (made === null) throw new Error("no edge");
  edge = made;
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ selectedEdgeIds: [] });
});

function model(overrides: Partial<LinkInspectorModel> = {}): LinkInspectorModel {
  const end = {
    kind: "card" as const,
    id: "card-1",
    title: "A card",
    glyph: "\u25a1",
    connector: null,
    connectorIndex: null,
    connectorCount: 4,
    boardId: "board-1",
    viaCardId: null,
  };
  return {
    edge,
    source: end,
    target: end,
    bidirectional: false,
    path: "bezier",
    mode: "bezier",
    bends: [],
    layer: "below",
    sourceCenter: null,
    targetCenter: null,
    description: "",
    labelOffset: 0.5,
    canEdit: true,
    canManageStructure: true,
    ...overrides,
  };
}

function draw(overrides: Partial<LinkInspectorModel> = {}) {
  render(
    <LinkInspector
      model={model(overrides)}
      onClose={vi.fn()}
      onNavigateEnd={vi.fn()}
      onMoveEnd={vi.fn()}
      movingEnd={null}
      onCancelMoveEnd={vi.fn()}
      onSetPath={vi.fn()}
      onSetBidirectional={vi.fn()}
      onReverse={vi.fn()}
      onDelete={vi.fn()}
      onSetDescription={vi.fn()}
      onSetLabelOffset={vi.fn()}
    />,
  );
}

/**
 * A link's appearance, through the one editor every surface uses.
 *
 * The panel used to carry its own colour row and its own line rows beside the shared Style tab it already mounted, so a
 * link had two of each. These tests ask the shared controls, which is the only place either value is edited now.
 */
describe("a link's appearance in the panel", () => {
  it("should offer the palette, and write the colour the reader picks", () => {
    draw();
    const swatch = DEFAULT_PALETTE[2];
    if (swatch === undefined) throw new Error("no palette");
    fireEvent.click(screen.getByTestId(`style-swatch-${swatch.id}`));

    expect(workspace.getEdge(edge.id)?.style?.swatch).toBe(swatch.id);
  });

  it("should clear the colour rather than store the word default", () => {
    workspace.setEdgeStyle(edge.id, { swatch: "rose" });
    draw({ edge: workspace.getEdge(edge.id) ?? edge });
    fireEvent.click(screen.getByTestId("style-swatch-default"));

    // "No swatch" is the theme's link colour, which is exactly what an unstyled link means.
    expect(workspace.getEdge(edge.id)?.style?.swatch).toBeUndefined();
  });

  it("should change the line without losing the colour", () => {
    workspace.setEdgeStyle(edge.id, { swatch: "rose" });
    draw({ edge: workspace.getEdge(edge.id) ?? edge });

    fireEvent.click(screen.getByTestId("style-line-paint-dashed"));
    fireEvent.change(screen.getByTestId("style-line-width"), { target: { value: "3" } });

    const style = workspace.getEdge(edge.id)?.style;
    // The regression the owner reported: a second write that drops the swatch is a link that turned blue.
    expect(style?.swatch).toBe("rose");
    expect(style?.sides?.top?.paint).toBe("dashed");
    expect(style?.sides?.top?.width).toBe(3);
  });

  it("should show which colour and line are in force", () => {
    workspace.setEdgeStyle(edge.id, {
      swatch: "rose",
      sides: { top: { paint: "dotted", width: 2 } },
    });
    draw({ edge: workspace.getEdge(edge.id) ?? edge });

    expect(screen.getByTestId("style-swatch-rose")).toHaveAttribute("data-checked", "true");
    expect(screen.getByTestId("style-line-paint-dotted")).toHaveAttribute("data-checked", "true");
    expect(screen.getByTestId("style-line-width")).toHaveValue("2");
  });

  it("should offer exactly one colour control, because a second one is how the two drift", () => {
    draw();
    expect(screen.getAllByTestId("style-swatches")).toHaveLength(1);
    expect(screen.queryByTestId("link-colours")).toBeNull();
    expect(screen.queryByTestId("link-line-styles")).toBeNull();
  });
});
