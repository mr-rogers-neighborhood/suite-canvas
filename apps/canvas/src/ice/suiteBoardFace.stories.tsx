import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { createSuiteBoardFaceLayer, type SuiteBoardFaceNode } from "./suiteBoardFace";

/**
 * The face is a plain DOM layer (no React, no ICE), so the story mounts it the
 * way the kind does: one inert layer in a container, synced once. That is the
 * whole contract — the layer follows `geometryOf()` and nothing else.
 */
interface BoardFaceStageProps {
  readonly boards: readonly SuiteBoardFaceNode[];
  /** The camera's zoom: the one thing that bands the face. */
  readonly zoom: number;
  /** Board ids that are selected — selection adds the card count, nothing else. */
  readonly selected?: readonly string[];
}

const NO_SELECTION: readonly string[] = [];

function BoardFaceStage({ boards, zoom, selected = NO_SELECTION }: BoardFaceStageProps) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    const layer = createSuiteBoardFaceLayer({
      container,
      nodes: () => boards,
      // World (0, 0) at the stage's top-left: the boards below are placed to fit.
      camera: () => ({ x: 0, y: 0, zoom }),
      selected: (id) => selected.includes(id),
    });
    layer.sync();
    return () => layer.dispose();
  }, [boards, zoom, selected]);

  return (
    <div
      ref={host}
      role="img"
      aria-label="Three Suite Boards: one nested two levels deep, one collapsed, one with a long name."
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--canvas-bg, #faf9f7)",
      }}
    />
  );
}

const nested: SuiteBoardFaceNode = {
  id: "board:nested",
  rect: { x: 40, y: 48, width: 340, height: 180 },
  depth: 2,
  name: "Interviews",
  color: "violet",
  cardCount: 7,
  childCount: 2,
  collapsed: false,
};

const collapsed: SuiteBoardFaceNode = {
  id: "board:collapsed",
  rect: { x: 440, y: 48, width: 240, height: 180 },
  depth: 1,
  name: "Archive",
  color: "amber",
  cardCount: 3,
  childCount: 5,
  collapsed: true,
};

const longName: SuiteBoardFaceNode = {
  id: "board:long",
  rect: { x: 40, y: 280, width: 640, height: 120 },
  depth: 0,
  name: "Field notes from the coastal survey — autumn 2026, unedited",
  color: "green",
  cardCount: 42,
  childCount: 9,
  collapsed: false,
};

const boards: readonly SuiteBoardFaceNode[] = [nested, collapsed, longName];

const meta = {
  title: "Canvas/ICE board face",
  component: BoardFaceStage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The screen-space face of `suite.board`: the Board's name above the mat's top edge and " +
          "its colour as a dot and a border. The name is drawn at rest — the GPU mat underneath " +
          "carries the Board's material but prints no legible name — and it survives fit zoom. " +
          "Selecting a Board adds its card count to the name pill.",
      },
    },
  },
  args: {
    boards,
    zoom: 1,
  },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BoardFaceStage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The three cases: nested (a plate stack), collapsed (dashed, no chips), long name (ellipsised). */
export const Default: Story = {};

/** The same Boards at fit zoom (0.12), where a reader looks at a whole plane. */
export const FitZoom: Story = { args: { zoom: 0.12 } };

/** At rest every Board is named, and no Board shows a count. */
export const AtRest: Story = { args: { zoom: 0.5 } };

/** Selection adds the count to the name pill; it is not what reveals the name. */
export const Selected: Story = { args: { zoom: 0.5, selected: ["board:nested"] } };

/** Below the compact threshold a mat is a dot, and a dot with a label is noise. */
export const Culled: Story = { args: { zoom: 0.02 } };
