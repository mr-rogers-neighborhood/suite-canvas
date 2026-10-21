import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card, CardType, Tag } from "@suite/graph";
import { CardInspector } from "./CardInspector";

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
    references: [
      { boardId: "b1", boardName: "Research", isHome: true, isCurrent: true },
      { boardId: "b2", boardName: "Drafts", isHome: false, isCurrent: false },
    ],
    onClose: () => {},
    onEdit: () => {},
    onSetType: () => {},
    onAddTag: () => {},
    onRemoveTag: () => {},
    onCreateTag: () => {},
    onSetProperty: () => {},
    onClearProperty: () => {},
    onManageTypes: () => {},
    onGoToBoard: () => {},
    onRemoveFromBoard: () => {},
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
