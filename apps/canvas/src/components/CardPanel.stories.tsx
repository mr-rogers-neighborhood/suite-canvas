import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card, CardType, Tag } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { CardPanel, type CardReferences, EMPTY_CARD_REFERENCES } from "./CardPanel";

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

const references: CardReferences = {
  incoming: [
    {
      key: "in:c2",
      cardId: "c2",
      title: "Onboarding friction",
      glyph: "P",
      boardId: "b1",
      boardName: "Research",
      snippet:
        "\u2026we should pair this with Onboarding friction before the next review, then re-read the notes\u2026",
    },
    {
      key: "in:c3",
      cardId: "c3",
      title: "Interview notes",
      glyph: "\u25a1",
      boardId: null,
    },
  ],
  outgoing: [
    {
      key: "out:c4",
      cardId: "c4",
      title: "Retention spike",
      glyph: "\u25a1",
      boardId: "b2",
      boardName: "Drafts",
    },
  ],
  property: [
    {
      key: "field:c5:contradicts",
      cardId: "c5",
      title: "Pricing memo",
      glyph: "P",
      boardId: "b1",
      boardName: "Research",
      fieldName: "Contradicts",
    },
  ],
  arrows: [
    {
      key: "arrow:e1",
      edgeId: "e1",
      cardId: "c6",
      title: "Launch plan",
      glyph: "P",
      boardId: "b2",
      boardName: "Drafts",
      description: "blocks the launch",
    },
  ],
};

const cardOptions = [
  { id: "c1", title: "Mastering the timeline" },
  { id: "c2", title: "Onboarding friction" },
  { id: "c3", title: "Interview notes" },
  { id: "c4", title: "Retention spike" },
];

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
    cards: cardOptions,
    references,
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
    onFocusReference: () => {},
    onFocusArrow: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CardPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Embedded: Story = {};

export const Inspector: Story = { args: { variant: "inspector" } };

export const NoReferences: Story = {
  args: { references: EMPTY_CARD_REFERENCES },
};

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
