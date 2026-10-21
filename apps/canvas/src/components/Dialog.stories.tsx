import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "./Dialog";

const meta = {
  title: "Components/Dialog",
  component: Dialog,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Delete board?",
    description: "Drafts has 3 card(s) on it. Cards can stay in the library, or move to the trash.",
    actions: [
      { label: "Keep cards", primary: true, onSelect: () => {} },
      { label: "Trash cards", danger: true, onSelect: () => {} },
    ],
    onClose: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DeleteBoard: Story = {};

export const WithoutDescription: Story = {
  args: { title: "Empty trash?" },
};
