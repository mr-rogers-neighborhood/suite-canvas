import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardTabs } from "./BoardTabs";

const boards = [
  { id: "b1", name: "Research", tags: [], createdAt: 0, updatedAt: 0 },
  { id: "b2", name: "Drafts", tags: [], createdAt: 1, updatedAt: 1 },
];

const meta = {
  title: "Components/BoardTabs",
  component: BoardTabs,
  parameters: { layout: "centered" },
  args: {
    boards,
    activeBoardId: "b1",
    onSelect: () => {},
    onCreate: () => {},
    onRename: () => {},
    onClose: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof BoardTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SecondBoardActive: Story = { args: { activeBoardId: "b2" } };

export const Empty: Story = { args: { boards: [], activeBoardId: null } };

const trailBoards = [
  ...boards,
  { id: "b3", name: "Archive", tags: [], createdAt: 2, updatedAt: 2 },
];

/** The trail reads a path, so a board reached by a tab says so. */
export const WithTrail: Story = {
  args: {
    boards: trailBoards,
    activeBoardId: "b2",
    history: [{ boardId: "b1", viewport: { x: 0, y: 0, zoom: 1 }, via: "manual" }],
  },
};

/** A board entered through a portal keeps its whole path, oldest first. */
export const WithTrailAfterPortal: Story = {
  args: {
    boards: trailBoards,
    activeBoardId: "b3",
    history: [
      { boardId: "b1", viewport: { x: 0, y: 0, zoom: 1 }, via: "manual" },
      { boardId: "b2", viewport: { x: 40, y: 20, zoom: 0.8 }, via: "portal" },
    ],
  },
};
