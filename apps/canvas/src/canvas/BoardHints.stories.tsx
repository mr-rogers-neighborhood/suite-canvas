import type { Meta, StoryObj } from "@storybook/react-vite";
import { NudgeHint } from "./BoardHints";

/**
 * The hint sits above the dock, over the board, so the story gives it the same
 * relatively positioned parent the canvas provides.
 */
const meta = {
  title: "Canvas/NudgeHint",
  component: NudgeHint,
  parameters: { layout: "fullscreen" },
  args: { count: 1 },
  decorators: [
    (Story) => (
      <div className="relative h-64 w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof NudgeHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThreeCards: Story = { args: { count: 3 } };
