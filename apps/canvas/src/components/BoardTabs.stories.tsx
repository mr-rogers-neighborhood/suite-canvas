import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardTabs } from "./BoardTabs";

const boards = [
  { id: "b1", name: "Research", createdAt: 0, updatedAt: 0 },
  { id: "b2", name: "Drafts", createdAt: 1, updatedAt: 1 },
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
    onDeleteRequest: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof BoardTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SecondBoardActive: Story = { args: { activeBoardId: "b2" } };

export const Empty: Story = { args: { boards: [], activeBoardId: null } };
