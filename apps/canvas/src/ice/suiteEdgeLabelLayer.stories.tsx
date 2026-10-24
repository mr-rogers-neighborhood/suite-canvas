import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { createSuiteEdgeLabelLayer, type SuiteEdgeLabelAnchor } from "./suiteEdgeLabelLayer";

/**
 * The label layer is plain DOM, so the story mounts it the way the surface does:
 * one inert layer in a container, synced once. The chips are screen pixels, so
 * the card of a faded "line" behind them is only there to say where the ink is.
 */
const CAMERA = { x: 0, y: 0, zoom: 1 };

const LABELS: readonly SuiteEdgeLabelAnchor[] = [
  { edgeId: "edge-1", label: "supports", point: { x: 320, y: 150 } },
  { edgeId: "edge-2", label: "contradicts the earlier finding", point: { x: 620, y: 300 } },
];

function LabelStage({ labels }: { readonly labels: readonly SuiteEdgeLabelAnchor[] }) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    const layer = createSuiteEdgeLabelLayer({
      container,
      camera: () => CAMERA,
      labels: () => labels,
    });
    container.append(layer.layer);
    layer.sync();
    return () => layer.dispose();
  }, [labels]);

  return (
    <div
      ref={host}
      role="img"
      aria-label="Two links drawn as thin lines, each labelled with a small chip at the middle of its ink."
      style={{
        position: "relative",
        width: "100%",
        height: "480px",
        overflow: "hidden",
        background: "var(--canvas-bg, #f2f1ee)",
      }}
    >
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <line x1={140} y1={90} x2={520} y2={220} stroke="#a8a29a" strokeWidth={2} />
        <line x1={420} y1={400} x2={840} y2={200} stroke="#a8a29a" strokeWidth={2} />
      </svg>
    </div>
  );
}

const meta: Meta<typeof LabelStage> = {
  title: "ICE/Edge labels",
  component: LabelStage,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof LabelStage>;

/** Two described links: the chip sits where the ink is read, not at a box corner. */
export const Described: Story = {
  args: { labels: LABELS },
};

/** An undescribed link draws no chip at all — the line alone is the whole object. */
export const Undescribed: Story = {
  args: { labels: [{ edgeId: "edge-1", label: "", point: { x: 320, y: 150 } }] },
};
