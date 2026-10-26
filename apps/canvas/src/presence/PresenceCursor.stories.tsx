import type { Meta, StoryObj } from "@storybook/react-vite";
import { PresenceCursor } from "./PresenceCursor";

const meta = {
  title: "Components/PresenceCursor",
  component: PresenceCursor,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof PresenceCursor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: { name: "Nova", color: "#f97316" },
    x: 40,
    y: 40,
  },
};
