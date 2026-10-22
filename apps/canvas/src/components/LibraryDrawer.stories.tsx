import type { Meta, StoryObj } from "@storybook/react-vite";
import { LibraryDrawer } from "./LibraryDrawer";
import { UNSORTED_SECTION } from "./libraryFilters";

const items = [
  {
    id: "c1",
    title: "Mastering the timeline",
    boards: [{ id: "b1", name: "Research" }],
    typeIds: ["note"],
    tagIds: ["t1"],
    sectionIds: ["s2", "s1"],
    properties: {},
  },
  {
    id: "c2",
    title: "Untitled",
    boards: [{ id: "b1", name: "Research" }],
    typeIds: ["note"],
    tagIds: [],
    sectionIds: [UNSORTED_SECTION],
    properties: {},
  },
];

const sectionOrder = [
  { id: "s1", title: "Sources", depth: 0 },
  { id: "s2", title: "Primary sources", depth: 1 },
];

const meta = {
  title: "Components/LibraryDrawer",
  component: LibraryDrawer,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    tab: "inbox",
    counts: { inbox: 2, cards: 6, trash: 1 },
    inbox: items,
    cards: items,
    trash: [
      {
        id: "c3",
        title: "Discarded idea",
        boards: [{ id: "b1", name: "Research" }],
        typeIds: ["concept"],
        tagIds: [],
        sectionIds: [],
        properties: {},
      },
    ],
    onTab: () => {},
    onClose: () => {},
    onPlace: () => {},
    onCreateInInbox: () => {},
    onTrash: () => {},
    onRestore: () => {},
    onDeleteForever: () => {},
    onEmptyTrash: () => {},
    onGoToBoard: () => {},
    onDropAt: () => {},
    types: [
      { id: "note", name: "Note", glyph: "\u25a1", createdAt: 0, updatedAt: 0, fields: [] },
      { id: "concept", name: "Concept", glyph: "\u25c6", createdAt: 1, updatedAt: 1, fields: [] },
    ],
    tags: [{ id: "t1", name: "Research", createdAt: 0 }],
    typeFilter: [],
    tagFilter: [],
    onToggleType: () => {},
    onToggleTag: () => {},
    onClearFilters: () => {},
    activeBoardId: "b1",
    activeBoardName: "Research",
    scope: "all",
    onScope: () => {},
    sectionFilter: [],
    onToggleSection: () => {},
    sectionOrder,
    groupBySection: false,
    onToggleGroup: () => {},
    onOpenCard: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LibraryDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};

export const Cards: Story = { args: { tab: "cards" } };

export const BoardScope: Story = {
  args: { tab: "cards", scope: "board", sectionFilter: ["s1"] },
};

export const GroupedBySection: Story = {
  args: { tab: "cards", scope: "board", groupBySection: true },
};

export const Trash: Story = { args: { tab: "trash" } };

export const Empty: Story = {
  args: { tab: "inbox", inbox: [], counts: { inbox: 0, cards: 6, trash: 0 }, trash: [] },
};
