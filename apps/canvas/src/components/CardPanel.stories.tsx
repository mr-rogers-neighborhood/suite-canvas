import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card, CardType, Tag } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { CardPanel } from "./CardPanel";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("c1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("c1").id;

const type: CardType = {
  id: "project",
  name: "Project",
  glyph: "P",
  createdAt: 0,
  updatedAt: 0,
  fields: [{ id: "owner", name: "Owner", kind: "text", required: false, order: 0, options: [] }],
};

const card: Card = {
  id: "c1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["project"],
  primaryTypeId: "project",
  tags: [],
  properties: { owner: "Ada Lovelace" },
};

const tags: Tag[] = [{ id: "t1", name: "Research", createdAt: 0 }];

const meta = {
  title: "Components/CardPanel",
  component: CardPanel,
  parameters: { layout: "centered" },
  args: {
    card: { ...card, tags: ["t1"] },
    title: "Mastering the timeline",
    types: [type],
    tags,
    fields: type.fields.map((field) => ({ typeId: "project", field })),
    where: {
      unplaced: false,
      entries: [
        {
          boardId: "b1",
          boardName: "Research",
          isHome: true,
          isCurrent: true,
          sectionPath: [{ id: "s1", name: "Timelines" }],
        },
        {
          boardId: "b2",
          boardName: "Drafts",
          isHome: false,
          isCurrent: false,
          sectionPath: [],
        },
      ],
    },
    variant: "embedded",
    editing: null,
    cardDoc: doc,
    contentId,
    titleId,
    cursorStore: null,
    localUser: null,
    peers: [],
    onStartEditing: () => {},
    onEditEnd: () => {},
    onSetType: () => {},
    onAddTag: () => {},
    onRemoveTag: () => {},
    onCreateTag: () => {},
    onSetProperty: () => {},
    onClearProperty: () => {},
    onManageTypes: () => {},
    onFocusCard: () => {},
    onFocusSection: () => {},
    onRemoveFromBoard: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CardPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Embedded: Story = {};

export const Inspector: Story = { args: { variant: "inspector" } };

export const EditingBody: Story = { args: { editing: "body" } };

export const Unsorted: Story = {
  args: {
    where: {
      unplaced: false,
      entries: [
        {
          boardId: "b1",
          boardName: "Research",
          isHome: true,
          isCurrent: true,
          sectionPath: [],
        },
      ],
    },
  },
};

export const InTheInbox: Story = {
  args: { where: { unplaced: true, entries: [] } },
};
