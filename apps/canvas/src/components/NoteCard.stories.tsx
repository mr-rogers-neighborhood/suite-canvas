import type { Meta, StoryObj } from "@storybook/react-vite";
import type { GraphNode } from "@suite/graph";
import { NoteCard } from "./NoteCard";

const meta = {
  title: "Components/NoteCard",
  component: NoteCard,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NoteCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const noteNode: GraphNode = {
  id: "n1",
  kind: "note",
  position: { x: 0, y: 0 },
  createdAt: 0,
  updatedAt: 0,
  data: { text: "A note on the canvas" },
};

export const Note: Story = {
  args: { node: noteNode },
};

export const Selected: Story = {
  args: { node: noteNode, selected: true },
};

export const Document: Story = {
  args: {
    node: {
      id: "n2",
      kind: "document",
      position: { x: 0, y: 0 },
      createdAt: 0,
      updatedAt: 0,
      data: { title: "A document", body: "Rich text body" },
    },
  },
};
