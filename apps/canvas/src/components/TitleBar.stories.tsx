import type { Meta, StoryObj } from "@storybook/react-vite";
import { TitleBar } from "./TitleBar";

const meta = {
  title: "Components/TitleBar",
  component: TitleBar,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof TitleBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  args: { status: "connected", peerCount: 2 },
};

export const Offline: Story = {
  args: { status: "disconnected", peerCount: 0 },
};
