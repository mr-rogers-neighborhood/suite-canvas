import type { Meta, StoryObj } from "@storybook/react-vite";
import { PresenceAvatars } from "./PresenceAvatars";

const meta = {
  title: "Components/PresenceAvatars",
  component: PresenceAvatars,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PresenceAvatars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    users: [
      { name: "Nova", color: "#f97316" },
      { name: "Atlas", color: "#7c3aed" },
      { name: "Quill", color: "#0891b2" },
    ],
  },
};
