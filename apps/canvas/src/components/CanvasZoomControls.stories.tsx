import type { Meta, StoryObj } from "@storybook/react-vite";
import { CanvasZoomControls } from "./CanvasZoomControls";

const meta = {
  title: "Canvas/CanvasZoomControls",
  component: CanvasZoomControls,
  parameters: { layout: "centered" },
  args: {
    zoom: 1,
    onZoomIn: () => {},
    onZoomOut: () => {},
    onFitView: () => {},
    onGraphView: () => {},
  },
} satisfies Meta<typeof CanvasZoomControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ZoomedOut: Story = { args: { zoom: 0.34 } };

export const GraphActive: Story = { args: { zoom: 0.1, graphActive: true } };

export const NoGraph: Story = { args: { canGraphView: false } };
