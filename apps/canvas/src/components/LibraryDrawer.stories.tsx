import type { Meta, StoryObj } from "@storybook/react-vite";
import { LibraryDrawer } from "./LibraryDrawer";

const items = [
  {
    id: "c1",
    title: "Mastering the timeline",
    boards: [{ id: "b1", name: "Research" }],
    typeIds: ["note"],
    tagIds: ["t1"],
  },
  { id: "c2", title: "Untitled", boards: [], typeIds: ["note"], tagIds: [] },
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
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LibraryDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};

export const Cards: Story = { args: { tab: "cards" } };

export const Trash: Story = { args: { tab: "trash" } };

export const Empty: Story = {
  args: { tab: "inbox", inbox: [], counts: { inbox: 0, cards: 6, trash: 0 }, trash: [] },
};
