import type { Meta, StoryObj } from "@storybook/react-vite";
import { PeekSurface } from "./PeekSurface";

const meta = {
  title: "Canvas/PeekSurface",
  component: PeekSurface,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="relative h-64 w-full p-6">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof PeekSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A card: its title, its type, the board it sits on, and one way in. */
export const Card: Story = {
  args: {
    peek: {
      entity: {
        target: { kind: "card", id: "alpha" },
        label: "Retrieval beats re-reading",
        kindLabel: "claim",
        detail: "On Research",
      },
      anchor: { x: 40, y: 20 },
    },
    onOpen: () => {},
  },
};

/** A board says how much is on it, because that is the only honest one-liner. */
export const Board: Story = {
  args: {
    peek: {
      entity: {
        target: { kind: "board", id: "research" },
        label: "Research",
        kindLabel: "board",
        detail: "12 cards",
      },
      anchor: { x: 40, y: 20 },
    },
    onOpen: () => {},
  },
};

/** A link names both ends, which is what makes it readable without opening it. */
export const Link: Story = {
  args: {
    peek: {
      entity: {
        target: { kind: "link", id: "edge-1" },
        label: "Untitled link",
        kindLabel: "references",
        detail: "Retrieval beats re-reading → Study plan",
      },
      anchor: { x: 40, y: 20 },
    },
    onOpen: () => {},
  },
};
