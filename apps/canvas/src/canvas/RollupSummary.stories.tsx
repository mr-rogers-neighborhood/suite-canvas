import type { Meta, StoryObj } from "@storybook/react-vite";
import { RollupSummary } from "./RollupSummary";
import type { Rollup } from "./rollup";

const rollup: Rollup = {
  cardId: "summary",
  title: "Reading list",
  members: [
    {
      cardId: "a",
      title: "Retrieval beats re-reading",
      kind: "claim",
      boardId: "b1",
      onBoard: true,
    },
    { cardId: "b", title: "Spaced repetition", kind: "concept", boardId: "b1", onBoard: true },
    { cardId: "c", title: "Study plan", kind: "note", boardId: "b2", onBoard: false },
  ],
  count: 3,
  elsewhere: 1,
};

const meta = {
  title: "Canvas/RollupSummary",
  component: RollupSummary,
  parameters: { layout: "fullscreen" },
  args: { rollup, onOpen: () => {} },
  decorators: [
    (Story) => (
      <div className="h-64 w-full p-6">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof RollupSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The collapsed card: a header line and a count that points at three rows. */
export const Collapsed: Story = {};

/** The same card opened: every row is the way back to what the count named. */
export const Expanded: Story = { args: { defaultExpanded: true } };

/** A card that points at nothing says so instead of showing a zero. */
export const NothingToSummarise: Story = {
  args: { rollup: { cardId: "empty", title: "Empty", members: [], count: 0, elsewhere: 0 } },
};
