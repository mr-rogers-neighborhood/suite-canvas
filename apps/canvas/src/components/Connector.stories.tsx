import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReactFlowProvider } from "@xyflow/react";
import { Connector } from "./Connector";

const meta = {
  title: "Components/Connector",
  component: Connector,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <ReactFlowProvider>
        <Story />
      </ReactFlowProvider>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Connector>;

export default meta;
type Story = StoryObj<typeof meta>;

const connector = { id: "c1", x: 0.5, y: 0 };

export const Default: Story = {
  args: {
    connector,
    nodeId: "n1",
    onSelect: () => {},
    onMoveEnd: () => {},
    onContextMenu: () => {},
  },
};

export const Selected: Story = {
  args: {
    connector,
    nodeId: "n1",
    selected: true,
    color: "#7c3aed",
    onSelect: () => {},
    onMoveEnd: () => {},
    onContextMenu: () => {},
  },
};
