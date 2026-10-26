import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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

export const Default: Story = {
  args: { onOpen: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByTestId("mention-chip");
    await expect(chip).toHaveTextContent("Onboarding friction");
    await userEvent.click(chip);
    await expect(args.onOpen as unknown as ReturnType<typeof fn>).toHaveBeenCalledWith(
      "card-1",
      undefined,
    );
  },
};

export const LongTitle: Story = {
  args: { title: "A very long card title that has to truncate inside a paragraph" },
};

export const NotShared: Story = {
  args: { title: "Private card", presence: "stub" },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole("note");
    // The reference survives the share boundary, but it reads as a note and
    // says so: no link affordance, no pretence that it can be opened.
    await expect(chip).toHaveAttribute("data-not-shared", "true");
    await expect(chip).toHaveTextContent("Private card");
    await expect(chip).toHaveTextContent("not shared");
    await expect(chip).toHaveAccessibleName("Private card \u2014 not shared");
  },
};

export const Unavailable: Story = {
  args: { unavailable: true },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByTestId("mention-chip");
    await expect(chip).toHaveAttribute("data-unavailable", "true");
    await expect(chip).toHaveTextContent("Unavailable card");
  },
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
