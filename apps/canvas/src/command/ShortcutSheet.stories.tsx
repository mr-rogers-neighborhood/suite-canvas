import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShortcutSheet } from "./ShortcutSheet";

const meta = {
  title: "Components/ShortcutSheet",
  component: ShortcutSheet,
  parameters: { layout: "fullscreen" },
  args: { onClose: () => {} },
  tags: ["autodocs"],
} satisfies Meta<typeof ShortcutSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
