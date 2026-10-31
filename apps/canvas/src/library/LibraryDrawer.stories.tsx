import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { LibraryDrawer } from "./LibraryDrawer";
import { UNSORTED_SECTION } from "./libraryFilters";

function addNode(parent: LoroMap, name: string): LoroMap {
  const children = parent.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", name);
  return node;
}

function addText(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const value = children.insertContainer(children.length, new LoroText());
  value.insert(0, text);
}

/**
 * Bodies for the search story: the drawer indexes the live document, so the
 * seeded cards carry the text the query matches.
 */
const searchWorkspace = (() => {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");

  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  addText(workspace.getTitle("c1"), "Mastering the timeline");
  addText(addNode(workspace.getContent("c1"), "paragraph"), "A pacing note about the second pass.");

  workspace.createCard({ id: "c2", boardId: board.id, position: { x: 320, y: 0 } });
  addText(workspace.getTitle("c2"), "Interview notes");
  addText(
    addNode(workspace.getContent("c2"), "paragraph"),
    "The editor talked about timeline structure and colour grading.",
  );
  workspace.doc.commit({ origin: "story" });
  return workspace;
})();

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
    title: "Interview notes",
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
    onPlaceCards: () => {},
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
    full: false,
    onFull: () => {},
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

export const Cards: Story = {
  args: {
    tab: "cards",
    workspace: searchWorkspace,
    counts: { inbox: 2, cards: 2, trash: 1 },
  },
  // The drawer indexes note bodies, not just titles: the query only matches the
  // second card through the word "grading" in its paragraph.
  play: async () => {
    await userEvent.type(screen.getByTestId("library-search"), "grading");
    await waitFor(() => expect(screen.queryByTestId("library-item-c1")).toBeNull());
    await expect(screen.getByTestId("library-item-c2")).toBeInTheDocument();
    await expect(screen.getByTestId("library-item-c2")).toHaveTextContent("Interview notes");
  },
};

export const BoardScope: Story = {
  args: { tab: "cards", scope: "board", sectionFilter: ["s1"] },
};

export const GroupedBySection: Story = {
  args: { tab: "cards", scope: "board", groupBySection: true },
};

export const Trash: Story = { args: { tab: "trash" } };

export const Media: Story = {
  args: {
    tab: "media",
    counts: { inbox: 2, cards: 6, media: 2, trash: 1 },
    media: [
      {
        id: "att-1",
        kind: "image",
        url: "https://example.com/cat.jpg",
        mime: "image/jpeg",
        name: "Cat Photo",
        width: 1200,
        height: 800,
        bytes: 1024 * 250,
        duration: null,
        videoId: null,
        cards: [{ id: "c1", title: "Project Brief" }],
      },
      {
        id: "yt-1",
        kind: "youtube",
        url: null,
        mime: null,
        name: "Demo Video",
        width: null,
        height: null,
        bytes: null,
        duration: null,
        videoId: "dQw4w9WgXcQ",
        cards: [{ id: "c2", title: "Interview notes" }],
      },
    ],
  },
};

export const SearchQuery: Story = {
  args: {
    tab: "cards",
    workspace: searchWorkspace,
    initialQuery: "timeline",
    counts: { inbox: 2, cards: 2, trash: 1 },
  },
};

export const SearchEmpty: Story = {
  args: { tab: "cards", workspace: searchWorkspace, initialQuery: "storyboard" },
};

export const Empty: Story = {
  args: { tab: "inbox", inbox: [], counts: { inbox: 0, cards: 6, trash: 0 }, trash: [] },
};
