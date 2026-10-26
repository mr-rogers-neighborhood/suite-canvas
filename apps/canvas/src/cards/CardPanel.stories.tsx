import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card, CardType, Tag } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { type CardLinks, CardPanel, EMPTY_CARD_LINKS } from "./CardPanel";

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

const film: CardType = {
  id: "film",
  name: "Film",
  glyph: "F",
  createdAt: 0,
  updatedAt: 0,
  fields: [
    { id: "status", name: "Status", kind: "text", required: true, order: 0, options: [] },
    { id: "runtime", name: "Runtime", kind: "number", required: false, order: 1, options: [] },
  ],
};

/** The same field name under two types: two rows, never merged (ADR-0053 §2). */
const projectStatus: CardType = {
  ...type,
  fields: [
    ...type.fields,
    { id: "project-status", name: "Status", kind: "text", required: true, order: 1, options: [] },
  ],
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

const links: CardLinks = {
  incoming: [
    {
      cardId: "c2",
      title: "Onboarding friction",
      glyph: "P",
      occurrences: [
        {
          key: "in:c2:mention:0",
          kind: "mention",
          detail: "\u2026we should pair this with Onboarding friction before the next review\u2026",
          boardId: "b1",
          boardName: "Research",
        },
      ],
      kinds: ["mention"],
      mutual: true,
      boardId: "b1",
      boardName: "Research",
    },
    {
      cardId: "c5",
      title: "Pricing memo",
      glyph: "P",
      occurrences: [
        {
          key: "in:c5:property:0",
          kind: "property",
          detail: "Contradicts",
          boardId: "b1",
          boardName: "Research",
        },
        {
          key: "in:c5:arrow:1",
          kind: "arrow",
          detail: "supersedes the earlier estimate",
          boardId: "b1",
          boardName: "Research",
        },
      ],
      kinds: ["property", "arrow"],
      relationship: "Contradicts",
      mutual: false,
      boardId: "b1",
      boardName: "Research",
    },
    {
      cardId: "c3",
      title: "Interview notes",
      glyph: "\u25a1",
      occurrences: [{ key: "in:c3:mention:0", kind: "mention", boardId: null }],
      kinds: ["mention"],
      mutual: false,
      boardId: null,
    },
  ],
  outgoing: [
    {
      cardId: "c4",
      title: "Retention spike",
      glyph: "\u25a1",
      occurrences: [
        {
          key: "out:c4:mention:0",
          kind: "mention",
          boardId: "b2",
          boardName: "Drafts",
        },
      ],
      kinds: ["mention"],
      mutual: false,
      boardId: "b2",
      boardName: "Drafts",
    },
    {
      cardId: "c6",
      title: "Launch plan",
      glyph: "P",
      occurrences: [
        {
          key: "out:c6:arrow:0",
          kind: "arrow",
          detail: "blocks the launch",
          boardId: "b2",
          boardName: "Drafts",
        },
      ],
      kinds: ["arrow"],
      mutual: false,
      boardId: "b2",
      boardName: "Drafts",
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
    links,
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
    onAddType: () => {},
    onRemoveType: () => {},
    onAddTag: () => {},
    onRemoveTag: () => {},
    onCreateTag: () => {},
    onSetProperty: () => {},
    onClearProperty: () => {},
    onOpenCardPanel: () => {},
    onManageTypes: () => {},
    onFocusCard: () => {},
    onFocusSection: () => {},
    onRemoveFromBoard: () => {},
    onFocusLink: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CardPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Embedded: Story = {};

export const Inspector: Story = { args: { variant: "inspector" } };

/**
 * A card that is a Project and a Film. The Project stays primary and keeps the
 * card's presentation; the Film only adds fields, and both types' "Status"
 * fields read as their own row under their own heading.
 */
export const MultiType: Story = {
  args: {
    card: {
      ...card,
      typeIds: ["project", "film"],
      primaryTypeId: "project",
      properties: { owner: "Ada Lovelace", "project-status": "In review", status: "Draft" },
    },
    types: [projectStatus, film],
    fields: [
      ...projectStatus.fields.map((field) => ({ typeId: "project", field })),
      ...film.fields.map((field) => ({ typeId: "film", field })),
    ],
  },
};

/** A card with no body opens straight into Content, placeholder included. */
export const EmptyBody: Story = {
  args: { variant: "inspector", bodyEmpty: true, links: EMPTY_CARD_LINKS },
};

export const NoLinks: Story = {
  args: { links: EMPTY_CARD_LINKS },
};

export const EditingBody: Story = { args: { editing: "body" } };

/** A share viewer: static values, inert out-of-share links, no edit affordances. */
export const ReadOnly: Story = {
  args: { variant: "inspector", readOnly: true },
};

/** The same surface with nothing to read yet: no placeholder invites typing. */
export const ReadOnlyEmptyBody: Story = {
  args: { variant: "inspector", readOnly: true, bodyEmpty: true, links: EMPTY_CARD_LINKS },
};

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
