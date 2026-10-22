import type { Meta, StoryObj } from "@storybook/react-vite";
import { CardPicker } from "./CardPicker";

const cards = [
  { id: "c1", title: "Onboarding friction" },
  { id: "c2", title: "Pricing page rewrite" },
  { id: "c3", title: "Support backlog" },
];

const meta = {
  title: "Components/CardPicker",
  component: CardPicker,
  args: {
    cards,
    label: "Contradicts",
    onChange: () => {},
    onClear: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-64 p-4">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof CardPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = { args: { value: "c2" } };

export const UnavailableSelection: Story = { args: { value: "purged-card" } };
