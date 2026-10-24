import type { Meta, StoryObj } from "@storybook/react-vite";
import { EdgeDescriptionInput } from "./EdgeDescriptionInput";

const meta = {
  title: "Canvas/EdgeDescriptionInput",
  component: EdgeDescriptionInput,
  parameters: { layout: "fullscreen" },
  args: {
    x: 240,
    y: 160,
    value: "",
    onCommit: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof EdgeDescriptionInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new description: the field opens empty at the double-click point. */
export const Empty: Story = {};

/** An existing description is preselected, so typing replaces all of it. */
export const Existing: Story = {
  args: { value: "blocks the plan" },
};
