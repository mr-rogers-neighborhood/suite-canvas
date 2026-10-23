import type { Meta, StoryObj } from "@storybook/react-vite";
import { MentionChip } from "./MentionChip";

const meta = {
  title: "Components/MentionChip",
  component: MentionChip,
  args: {
    cardId: "card-1",
    title: "Onboarding friction",
    onOpen: () => {},
  },
  decorators: [
    (Story) => (
      <p className="max-w-md p-4 text-sm text-[var(--ink)]">
        Read the <Story /> before the rewrite lands.
      </p>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof MentionChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongTitle: Story = {
  args: { title: "A very long card title that has to truncate inside a paragraph" },
};

export const NotShared: Story = {
  args: { title: "Private card", presence: "stub" },
};

export const Unavailable: Story = {
  args: { unavailable: true },
};

/** The three states a share boundary can put a mention in, side by side. */
export const States: Story = {
  render: () => (
    <span className="flex flex-col items-start gap-2">
      <span>
        Shared card <MentionChip cardId="card-1" title="Onboarding friction" onOpen={() => {}} />
      </span>
      <span>
        Referenced only <MentionChip cardId="card-2" title="Private card" presence="stub" />
      </span>
      <span>
        Gone <MentionChip cardId="card-3" title="" presence="missing" />
      </span>
    </span>
  ),
};
