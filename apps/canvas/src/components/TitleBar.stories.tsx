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

/** Back from offline and pushing the local edits: "Syncing" in the same amber slot. */
export const Reconnecting: Story = {
  args: { status: "rejoining", peerCount: 1 },
};

/** A share link says what the reader can do inside the status panel, not in the chrome. */
export const ViewerShare: Story = {
  args: { status: "connected", role: "viewer", workspaceName: "Board share" },
};

export const EditorShare: Story = {
  args: { status: "connected", role: "editor", workspaceName: "Quiet Harbor" },
};

/**
 * The one status: what this device can say about its own copy lives under the
 * same control that says who else is here (ADR-0064 amendment).
 */
export const WithStorage: Story = {
  args: {
    status: "connected",
    peerCount: 1,
    storage: (
      <div className="text-[12px] leading-5">
        <h2 className="text-[13px] font-semibold text-[var(--ink)]">This device</h2>
        <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Saved on this device</p>
        <p className="mt-2 text-[var(--ink)]">Sign in to keep this workspace anywhere.</p>
      </div>
    ),
  },
};
