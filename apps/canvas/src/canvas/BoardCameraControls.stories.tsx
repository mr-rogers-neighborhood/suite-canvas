import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReactFlowProvider } from "@xyflow/react";
import { BoardCameraControls } from "./BoardCameraControls";

/**
 * The controls render inside React Flow's `<Controls>` on the board; the story
 * supplies the provider they read their viewport from.
 */
const meta = {
  title: "Canvas/BoardCameraControls",
  component: BoardCameraControls,
  parameters: { layout: "centered" },
  args: {
    hasSelection: true,
    onZoomToSelection: () => {},
    outlineOpen: true,
    onToggleOutline: () => {},
  },
  decorators: [
    (Story) => (
      <ReactFlowProvider>
        <div className="flex flex-col rounded-lg border border-[var(--hairline)] p-1">
          <Story />
        </div>
      </ReactFlowProvider>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof BoardCameraControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyBoard: Story = { args: { hasSelection: false, outlineOpen: false } };
