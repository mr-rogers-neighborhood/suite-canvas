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

/** Back from offline and pushing the local edits, in the same amber slot. */
export const Reconnecting: Story = {
  args: { status: "rejoining", peerCount: 1 },
};

/** A share link names what the reader can do where a live session says Live. */
export const ViewerShare: Story = {
  args: { status: "connected", role: "viewer", workspaceName: "Board share" },
};

export const EditorShare: Story = {
  args: { status: "connected", role: "editor", workspaceName: "Quiet Harbor" },
};
