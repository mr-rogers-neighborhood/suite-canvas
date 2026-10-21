import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card } from "@suite/graph";
import { ReactFlowProvider } from "@xyflow/react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { NodeCard } from "./NodeCard";

const doc = new Y.Doc();
const fragment = doc.getXmlFragment("story");

const card: Card = {
  id: "n1",
  kind: "note",
  createdAt: 0,
  updatedAt: 0,
  connectors: [
    { id: "c-top", x: 0.5, y: 0 },
    { id: "c-right", x: 1, y: 0.5 },
    { id: "c-bottom", x: 0.5, y: 1 },
    { id: "c-left", x: 0, y: 0.5 },
  ],
  data: {},
};
const titleFragment = doc.getXmlFragment("story-title");

const meta = {
  title: "Components/NodeCard",
  component: NodeCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <ReactFlowProvider>
        <Story />
      </ReactFlowProvider>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof NodeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const base = {
  card,
  fragment,
  titleFragment,
  boardId: "board-1",
  awareness: null,
};

const shared = [
  { boardId: "board-1", boardName: "Research", isHome: true, isCurrent: false },
  { boardId: "board-2", boardName: "Drafts", isHome: false, isCurrent: true },
];

export const ReadOnly: Story = { args: base };

export const Selected: Story = { args: { ...base, selected: true } };

export const EditingTitle: Story = { args: { ...base, editing: "title" } };

export const EditingBody: Story = { args: { ...base, editing: "body" } };

export const SharedCard: Story = { args: { ...base, references: shared } };

export const WithPresence: Story = {
  args: {
    ...base,
    presence: [
      { name: "Nova", color: "#f97316" },
      { name: "Atlas", color: "#7c3aed" },
    ],
  },
};

export const WithAwareness: Story = { args: { ...base, awareness: new Awareness(doc) } };
