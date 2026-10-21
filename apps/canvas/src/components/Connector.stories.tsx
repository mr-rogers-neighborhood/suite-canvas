import type { Meta, StoryObj } from "@storybook/react-vite";
import { Connector } from "./Connector";

const meta = {
  title: "Components/Connector",
  component: Connector,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Connector>;

export default meta;
type Story = StoryObj<typeof meta>;

const connector = { id: "c1", x: 0.5, y: 0 };

export const Default: Story = {
  args: {
    connector,
    onSelect: () => {},
    onMoveEnd: () => {},
    onContextMenu: () => {},
  },
};

export const Selected: Story = {
  args: {
    connector,
    selected: true,
    color: "#7c3aed",
    onSelect: () => {},
    onMoveEnd: () => {},
    onContextMenu: () => {},
  },
};
