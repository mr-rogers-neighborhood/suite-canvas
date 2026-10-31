import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorToolbar } from "./EditorToolbar";

/**
 * The formatting row, drawn without a live document.
 *
 * `editor` is null in these stories on purpose: the toolbar renders from the `active` record
 * rather than from the editor, which is what lets it be drawn in a workshop and in a test.
 * The heading control is the one visual difference from the row that used to exist, so the
 * stories show it at rest and in a level.
 */
const meta = {
  title: "Cards/EditorToolbar",
  component: EditorToolbar,
  parameters: { layout: "centered" },
  args: { editor: null, active: {} },
} satisfies Meta<typeof EditorToolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Body text: the heading control says what a press would change, which is nothing yet. */
export const BodyText: Story = {};

/** In a heading: the control shows the level, and it is the only pressed heading state. */
export const InAHeading: Story = {
  args: { active: { "heading-2": true } },
};

/** Several marks and a list: the pressed states the toolbar reads from `activeCommands`. */
export const MarksAndAList: Story = {
  args: { active: { bold: true, italic: true, "bullet-list": true } },
};

/** A narrow column is the reason the row wraps rather than overflowing. */
export const NarrowColumn: Story = {
  args: { active: { bold: true } },
  decorators: [
    (Story) => (
      <div style={{ width: "200px" }}>
        <Story />
      </div>
    ),
  ],
};
