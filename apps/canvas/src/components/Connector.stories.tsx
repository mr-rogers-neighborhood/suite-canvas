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

/** A peer is holding this connector, so it eases toward their position. */
export const MovingByPeer: Story = {
  args: {
    connector,
    nodeId: "n1",
    movingPeers: [{ name: "Marlowe", color: "#f97316" }],
    peerPosition: { x: 0.2, y: 0.1 },
    onSelect: () => {},
    onMoveEnd: () => {},
    onContextMenu: () => {},
  },
};

/** A peer has clicked this connector (no drag), shown as a dashed outline. */
export const SelectedByPeer: Story = {
  args: {
    connector,
    nodeId: "n1",
    selectingPeers: [{ name: "Marlowe", color: "#f97316" }],
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
