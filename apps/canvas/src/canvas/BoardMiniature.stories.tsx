import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Placement, Section } from "@suite/graph";
import { BoardMiniature } from "./BoardMiniature";
import { boardMiniature, miniatureDots } from "./portalMiniature";

const placement = (cardId: string, x: number, y: number, width?: number): Placement => ({
  boardId: "b1",
  cardId,
  x,
  y,
  z: 0,
  createdAt: 0,
  ...(width ? { width } : {}),
});

const sections: Section[] = [
  {
    id: "s1",
    boardId: "b1",
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
  {
    id: "s2",
    boardId: "b1",
    title: "Next",
    x: 460,
    y: 0,
    width: 420,
    height: 320,
    z: 1,
    color: "green",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  },
];

const placements = [
  placement("c1", 30, 40),
  placement("c2", 40, 230, 260),
  placement("c3", 500, 60),
  placement("c4", 520, 240, 300),
];

const model = boardMiniature(sections, placements);

/** A frame at the size a portal card gives the miniature. */
const frame = (Story: () => React.ReactElement) => (
  <div style={{ width: 300, height: 200 }}>
    <Story />
  </div>
);

const meta = {
  title: "Canvas/BoardMiniature",
  component: BoardMiniature,
  parameters: { layout: "centered" },
  args: { model, label: "Research board miniature" },
  decorators: [frame],
  tags: ["autodocs"],
} satisfies Meta<typeof BoardMiniature>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Sections only: a board somebody has framed but not populated yet. */
export const SectionsOnly: Story = {
  args: { model: boardMiniature(sections, []) },
};

export const Empty: Story = {
  args: { model: boardMiniature([], []) },
};

/** Peer dots sit at the card each reader is focused on. */
export const WithPeers: Story = {
  args: {
    model,
    dots: miniatureDots(model, [
      { focus: { nodeId: "c2" }, user: { name: "Ada", color: "#f97316" } },
      { focus: { nodeId: "c3" }, user: { name: "Bob", color: "#3b82f6" } },
    ]),
  },
};
