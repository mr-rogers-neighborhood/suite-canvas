import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import type { ConnectorAnchor } from "./iceLinkDrag";
import { createSuiteConnectorLayer } from "./suiteConnectorLayer";

/**
 * The connector layer is plain DOM, so the story mounts it the way the surface
 * does: one inert layer in a container, synced once. The dots are the press
 * targets (the gesture hit-tests the same anchors); the line is the drag.
 */
const HOVERED_CARD = { x: 260, y: 140, width: 288, height: 200 };

const ANCHORS: readonly ConnectorAnchor[] = [
  { connectorId: "north", point: { x: HOVERED_CARD.x + 144, y: HOVERED_CARD.y } },
  { connectorId: "east", point: { x: HOVERED_CARD.x + 288, y: HOVERED_CARD.y + 100 } },
  { connectorId: "south", point: { x: HOVERED_CARD.x + 144, y: HOVERED_CARD.y + 200 } },
  { connectorId: "west", point: { x: HOVERED_CARD.x, y: HOVERED_CARD.y + 100 } },
];

function ConnectorStage({
  anchors,
  drag,
}: {
  readonly anchors: readonly ConnectorAnchor[];
  readonly drag: {
    from: { x: number; y: number };
    pointer: { x: number; y: number };
    target: { x: number; y: number } | null;
  } | null;
}) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    const layer = createSuiteConnectorLayer({
      container,
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      anchors: () => anchors,
      drag: () => drag,
    });
    container.append(layer.layer);
    layer.sync();
    return () => layer.dispose();
  }, [anchors, drag]);

  return (
    <div
      ref={host}
      role="img"
      aria-label="A hovered card with four connector dots and a dashed line being dragged to another card's connector."
      style={{
        position: "relative",
        width: "100%",
        height: "480px",
        overflow: "hidden",
        background: "var(--canvas-bg, #f2f1ee)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: HOVERED_CARD.x,
          top: HOVERED_CARD.y,
          width: HOVERED_CARD.width,
          height: HOVERED_CARD.height,
          borderRadius: 8,
          background: "var(--surface, #ffffff)",
          boxShadow: "0 1px 3px rgb(0 0 0 / 0.16)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 660,
          top: 200,
          width: 288,
          height: 200,
          borderRadius: 8,
          background: "var(--surface, #ffffff)",
          boxShadow: "0 1px 3px rgb(0 0 0 / 0.16)",
        }}
      />
    </div>
  );
}

const meta: Meta<typeof ConnectorStage> = {
  title: "ICE/Connector layer",
  component: ConnectorStage,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof ConnectorStage>;

export const Hovered: Story = {
  args: { anchors: ANCHORS, drag: null },
};

export const DraggingTowardACard: Story = {
  args: {
    anchors: ANCHORS,
    drag: {
      from: { x: 548, y: 240 },
      pointer: { x: 700, y: 300 },
      target: null,
    },
  },
};

export const SnappedToATarget: Story = {
  args: {
    anchors: [...ANCHORS, { connectorId: "target-west", point: { x: 660, y: 300 } }],
    drag: {
      from: { x: 548, y: 240 },
      pointer: { x: 690, y: 302 },
      target: { x: 660, y: 300 },
    },
  },
};
