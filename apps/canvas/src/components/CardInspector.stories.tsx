import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card, CardType, Tag } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { CardInspector } from "./CardInspector";
import type { CardReferences } from "./CardPanel";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("c1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("c1").id;

const type: CardType = {
  id: "project",
  name: "Project",
  glyph: "P",
  createdAt: 0,
  updatedAt: 0,
  fields: [
    {
      id: "stage",
      name: "Stage",
      kind: "select",
      required: true,
      order: 0,
      options: [
        { id: "backlog", label: "Backlog", order: 0 },
        { id: "active", label: "Active", order: 1 },
      ],
    },
    { id: "owner", name: "Owner", kind: "text", required: false, order: 1, options: [] },
  ],
};

const note: CardType = {
  id: "note",
  name: "Note",
  glyph: "\u25a1",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

const tags: Tag[] = [{ id: "t1", name: "Research", createdAt: 0 }];

const card: Card = {
  id: "c1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["project"],
  primaryTypeId: "project",
  tags: ["t1"],
  properties: { stage: "active" },
};

const references: CardReferences = {
  incoming: [
    {
      key: "in:c2",
      cardId: "c2",
      title: "Onboarding friction",
      glyph: "P",
      boardId: "b1",
      boardName: "Research",
      snippet: "\u2026pair this with Onboarding friction before the next review\u2026",
    },
  ],
  outgoing: [
    {
      key: "out:c3",
      cardId: "c3",
      title: "Retention spike",
      glyph: "\u25a1",
      boardId: "b2",
      boardName: "Drafts",
    },
  ],
  property: [
    {
      key: "field:c4:contradicts",
      cardId: "c4",
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
      cardId: "c5",
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
  { id: "c3", title: "Retention spike" },
];

const meta = {
  title: "Components/CardInspector",
  component: CardInspector,
  parameters: { layout: "fullscreen" },
  args: {
    card,
    title: "Mastering the timeline",
    types: [note, type],
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
          sectionPath: [
            { id: "s1", name: "Timelines" },
            { id: "s2", name: "Drafts", color: "var(--section-blue)" },
          ],
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
    linkCount: 4,
    editing: null,
    cardDoc: doc,
    contentId,
    titleId,
    cursorStore: null,
    localUser: null,
    peers: [],
    onClose: () => {},
    onEdit: () => {},
    onStartEditing: () => {},
    onEditEnd: () => {},
    onSetType: () => {},
    onAddTag: () => {},
    onRemoveTag: () => {},
    onCreateTag: () => {},
    onSetProperty: () => {},
    onClearProperty: () => {},
    bodyFields: [],
    onShowInBody: () => {},
    onHideFromBody: () => {},
    onOpenCardPanel: () => {},
    onManageTypes: () => {},
    onFocusCard: () => {},
    onFocusSection: () => {},
    onRemoveFromBoard: () => {},
    onFocusReference: () => {},
    onFocusArrow: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CardInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoFields: Story = {
  args: {
    card: { ...card, typeIds: ["note"], primaryTypeId: "note", properties: {} },
    fields: [],
  },
};

export const InTheInbox: Story = {
  args: { where: { unplaced: true, entries: [] } },
};

export const EditingBody: Story = {
  args: { editing: "body" },
};
