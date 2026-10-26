import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenu } from "./ContextMenu";

const meta = {
  title: "Components/ContextMenu",
  component: ContextMenu,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Canvas: Story = {
  args: {
    x: 0,
    y: 0,
    items: [{ label: "New note", onSelect: () => {} }],
    onClose: () => {},
  },
};

export const Node: Story = {
  args: {
    x: 0,
    y: 0,
    items: [{ label: "Delete note", danger: true, onSelect: () => {} }],
    onClose: () => {},
  },
};
