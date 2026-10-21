import type { Meta, StoryObj } from "@storybook/react-vite";
import type { GraphNode } from "@suite/graph";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { NodeCard } from "./NodeCard";

const doc = new Y.Doc();
const fragment = doc.getXmlFragment("story");

const node: GraphNode = {
  id: "n1",
  kind: "note",
  position: { x: 0, y: 0 },
  createdAt: 0,
  updatedAt: 0,
  z: 0,
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
  tags: ["autodocs"],
} satisfies Meta<typeof NodeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {
  args: { node, fragment, awareness: null },
};

export const Selected: Story = {
  args: { node, fragment, awareness: null, selected: true },
};

export const Editing: Story = {
  args: { node, fragment, awareness: null, editing: true },
};

export const WithPresence: Story = {
  args: {
    node,
    fragment,
    awareness: null,
    presence: [
      { name: "Nova", color: "#f97316" },
      { name: "Atlas", color: "#7c3aed" },
    ],
  },
};

export const WithAwareness: Story = {
  args: { node, fragment, awareness: new Awareness(doc) },
};
