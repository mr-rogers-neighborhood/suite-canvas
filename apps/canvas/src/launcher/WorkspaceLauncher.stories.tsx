import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

/**
 * The launcher mounts on its own: its recents come from this browser's
 * `localStorage`, so the workshop shows the empty state unless the story seeds
 * a list. The account slot loads `/api/auth` on demand and stays absent here.
 */
const meta = {
  title: "Screens/WorkspaceLauncher",
  component: WorkspaceLauncher,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspaceLauncher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
