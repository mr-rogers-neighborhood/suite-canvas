import type { Meta, StoryObj } from "@storybook/react-vite";
import { SceneOutline, type SceneOutlineItem } from "./SceneOutline";

const items: SceneOutlineItem[] = [
  {
    id: "board:root",
    label: "Research",
    kind: "board",
    depth: 0,
    lod: "full",
    expanded: true,
    hasChildren: true,
    cardCount: 6,
  },
  {
    id: "portal:sources",
    label: "Sources",
    kind: "portal",
    depth: 1,
    lod: "compact",
    expanded: true,
    hasChildren: true,
    portalCardId: "portal-sources",
    cardCount: 4,
    peers: [{ name: "Ada", color: "#3b82f6" }],
  },
  {
    id: "board:sources",
    label: "Sources",
    kind: "board",
    depth: 2,
    lod: "icon",
    expanded: false,
    hasChildren: false,
    boardId: "sources",
  },
  {
    id: "portal:back",
    label: "Research",
    kind: "cycle",
    depth: 3,
    lod: "hidden",
    expanded: false,
    hasChildren: false,
    cycle: true,
  },
];

const meta = {
  title: "Canvas/SceneOutline",
  component: SceneOutline,
  parameters: { layout: "fullscreen" },
  args: {
    items,
    activeId: "portal:sources",
    open: true,
    onToggleOpen: () => {},
    onSelect: () => {},
    onToggleExpand: () => {},
    onBack: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-96 w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof SceneOutline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = { args: { open: false } };

export const UnavailableTarget: Story = {
  args: {
    items: items.map((item) =>
      item.id === "board:sources" ? { ...item, unavailable: true } : item,
    ),
  },
};
