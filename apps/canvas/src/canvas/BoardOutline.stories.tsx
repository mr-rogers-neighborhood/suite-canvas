import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Section } from "@suite/graph";
import type { PeerPresence } from "../collab/presence";
import { OutlineTree } from "./BoardOutline";

const sections: Section[] = [
  {
    id: "research",
    boardId: "board-1",
    title: "Research",
    x: 0,
    y: 0,
    width: 640,
    height: 460,
    z: 0,
    color: "blue",
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "sources",
    boardId: "board-1",
    title: "Sources",
    x: 48,
    y: 72,
    width: 280,
    height: 200,
    z: 0,
    color: "green",
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "drafts",
    boardId: "board-1",
    title: "",
    x: 720,
    y: 0,
    width: 300,
    height: 220,
    z: 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

const membership = new Map([
  ["card-1", "research"],
  ["card-2", "research"],
  ["card-3", "sources"],
]);

const peer: PeerPresence = {
  clientId: "peer-1",
  board: "board-1",
  user: { name: "Ada", color: "#3b82f6" },
  pointer: null,
  focus: null,
  dragging: null,
  selection: { nodeIds: [], sectionId: "sources" },
  connector: null,
  resizing: null,
  sectionDrag: null,
  sectionResize: null,
  reconnect: null,
  connect: null,
  labelDrag: null,
  selectionBox: null,
};

const meta = {
  title: "Canvas/BoardOutline",
  component: OutlineTree,
  parameters: { layout: "fullscreen" },
  args: {
    sections,
    membership,
    peers: [peer],
    selectedSectionId: "research",
    open: true,
    onToggle: () => {},
    onSelect: () => {},
    onContextMenu: () => {},
    canCreate: true,
  },
  decorators: [
    (Story) => (
      <div className="relative h-96 w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof OutlineTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = { args: { open: false } };

export const Empty: Story = { args: { sections: [], membership: new Map(), peers: [] } };
