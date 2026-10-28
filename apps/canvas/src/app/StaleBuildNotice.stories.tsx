import type { Meta, StoryObj } from "@storybook/react-vite";
import { StaleBuildNotice } from "./StaleBuildNotice";

/**
 * The line a tab shows once a deploy has moved on without it. It sits under the
 * top bar, centred, and never reloads on its own.
 */
const meta = {
  title: "App/StaleBuildNotice",
  component: StaleBuildNotice,
  parameters: { layout: "fullscreen" },
  args: { onReload: () => {} },
} satisfies Meta<typeof StaleBuildNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
