import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card } from "@suite/graph";
import { ReactFlowProvider } from "@xyflow/react";
import { LoroDoc } from "loro-crdt";
import { NodeCard } from "./NodeCard";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("n1").id;

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
  cardDoc: doc,
  contentId,
  titleId,
  cursorStore: null,
  localUser: null,
  boardId: "board-1",
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

export const Resized: Story = { args: { ...base, width: 340, height: 180 } };

export const ResizingByPeer: Story = {
  args: { ...base, resizingPeers: [{ name: "Nova", color: "#f97316" }] },
};

export const WithPresence: Story = {
  args: {
    ...base,
    presence: [
      { name: "Nova", color: "#f97316" },
      { name: "Atlas", color: "#7c3aed" },
    ],
  },
};
