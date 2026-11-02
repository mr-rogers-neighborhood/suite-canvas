import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import type { ReactElement } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { LinkInspector } from "./LinkInspector";
import { useLinkInspectorModel } from "./useLinkInspectorModel";

/**
 * One link, inspected — and the claim this story exists to check is that its colour row is the same row a card wears.
 *
 * A link used to have a second colour control of its own: text buttons with the light value baked in, beside the shared
 * Style tab it already mounted, so one value had two editors that disagreed about dark mode. Now there is one row,
 * labelled for what it does to a stroke.
 */
function fixture(): void {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const from = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const to = workspace.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  workspace.setTitleText(from.id, "Spacing and retrieval");
  workspace.setTitleText(to.id, "The testing effect");
  const edge = workspace.addEdge({
    boardId: board.id,
    source: from.id,
    target: to.id,
    kind: "relates-to",
  });
  if (edge === null) throw new Error("two placed cards are a drawable link");
  workspace.setEdgeStyle(edge.id, { swatch: "amber", sides: { top: { paint: "dashed" } } });

  // The panel reads the board's selection from the stores, which is what a press on the line writes.
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ selectedEdgeIds: [edge.id], selectedNodeIds: [] });
}

function Panel(): ReactElement {
  const model = useLinkInspectorModel();
  if (model === null) return <p style={{ padding: 12, fontSize: 12 }}>No link selected.</p>;
  return (
    <LinkInspector
      model={model}
      onClose={() => {}}
      onNavigateEnd={() => {}}
      onMoveEnd={() => {}}
      movingEnd={null}
      onCancelMoveEnd={() => {}}
      onSetPath={() => {}}
      onSetBidirectional={() => {}}
      onReverse={() => {}}
      onDelete={() => {}}
      onSetDescription={() => {}}
      onSetLabelOffset={() => {}}
    />
  );
}

const meta = {
  title: "Panels/LinkInspector",
  decorators: [
    (Story: () => ReactElement) => (
      <div style={{ width: 320, height: 620, display: "flex", background: "var(--surface-muted)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** A coloured, dashed link: the row reads "Colour", and the line rows belong to the same editor. */
export const Coloured: Story = {
  render: () => {
    fixture();
    return <Panel />;
  },
};
