import type { Meta, StoryObj } from "@storybook/react-vite";
import { PortalCard } from "./PortalCard";
import { boardMiniature } from "./portalMiniature";

const model = boardMiniature(
  [
    {
      id: "s1",
      boardId: "b2",
      title: "Now",
      x: 0,
      y: 0,
      width: 420,
      height: 320,
      z: 0,
      color: "blue",
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  [
    { boardId: "b2", cardId: "c1", x: 30, y: 40, z: 0, createdAt: 0 },
    { boardId: "b2", cardId: "c2", x: 260, y: 40, z: 1, createdAt: 1 },
    { boardId: "b2", cardId: "c3", x: 30, y: 220, z: 2, createdAt: 2 },
  ],
);

const meta = {
  title: "Canvas/PortalCard",
  component: PortalCard,
  parameters: { layout: "centered" },
  args: {
    boardName: "Research",
    glyph: "\u25c9",
    model,
    onOpen: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PortalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = { args: { selected: true } };

/** Peers on the target board ride on the card, whether or not a card has focus. */
export const WithPeers: Story = {
  args: {
    peers: [
      { name: "Ada", color: "#f97316" },
      { name: "Bob", color: "#3b82f6" },
    ],
  },
};

export const EmptyTarget: Story = {
  args: { boardName: "Drafts", model: boardMiniature([], []) },
};

/** A deleted target leaves the card readable and inert. */
export const Unavailable: Story = {
  args: { boardName: null, model: boardMiniature([], []) },
};
