import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SyncInfo } from "../store/useCanvasStore";
import { TitleBar } from "./TitleBar";

const meta = {
  title: "Components/TitleBar",
  component: TitleBar,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof TitleBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const thisDevice = { deviceId: "b".repeat(64), name: "this laptop", role: "owner" } as const;
const otherDevice = { deviceId: "c".repeat(64), name: "the desktop", role: "editor" } as const;

function shared(state: SyncInfo["status"]): SyncInfo {
  return {
    workspaceId: "a".repeat(64),
    deviceId: thisDevice.deviceId,
    status: state,
    members: [thisDevice, otherDevice],
  };
}

/** Nobody else has a copy, which is the default and the design. */
export const LocalOnly: Story = {
  args: { sync: null },
};

export const Syncing: Story = {
  args: { sync: shared({ state: "syncing", count: 4 }) },
};

/** An invitation was used, and the other person has not let this device in yet. */
export const Waiting: Story = {
  args: { sync: { ...shared({ state: "waiting" }), members: [] } },
};

/** The machine sharing the workspace is not answering. Changes still save here. */
export const HostAsleep: Story = {
  args: { sync: shared({ state: "asleep", reason: "the host is not answering" }) },
};

/** A share link says what the reader can do; there are no share links in this build. */
export const ViewerShare: Story = {
  args: {
    sync: shared({ state: "syncing", count: 2 }),
    role: "viewer",
    workspaceName: "Board share",
  },
};
