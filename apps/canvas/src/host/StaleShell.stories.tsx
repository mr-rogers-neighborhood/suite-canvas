import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { StaleShell } from "./StaleShell";

/**
 * The page a window renders when its shell predates the renderer. It is a whole
 * page, so each story is a viewport rather than a control state.
 */
const meta = {
  title: "Shell/StaleShell",
  component: StaleShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StaleShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A shell missing the method that made the failure visible. */
export const MissingRecentFiles: Story = {
  args: { missing: ["recentFiles"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading")).toHaveTextContent(
      "This window's shell is out of date.",
    );
    await expect(canvas.getByText("Restart Suite to load the current shell.")).toBeInTheDocument();
  },
};

/** Several missing methods, which is what a two-release-old preload reports. */
export const MissingSeveral: Story = {
  args: { missing: ["recentFiles", "forgetRecent", "openDocument"] },
};
