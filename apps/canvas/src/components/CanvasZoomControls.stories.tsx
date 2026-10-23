import type { Meta, StoryObj } from "@storybook/react-vite";
import { CanvasZoomControls } from "./CanvasZoomControls";

const meta = {
  title: "Canvas/CanvasZoomControls",
  component: CanvasZoomControls,
  parameters: { layout: "centered" },
  args: {
    onZoomIn: () => {},
    onZoomOut: () => {},
    onFitView: () => {},
    onGraphView: () => {},
  },
} satisfies Meta<typeof CanvasZoomControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const GraphActive: Story = { args: { graphActive: true } };

export const NoGraph: Story = { args: { canGraphView: false } };
