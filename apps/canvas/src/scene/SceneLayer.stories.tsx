import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Card, CardType, Placement, Section, Tag } from "@suite/graph";
import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { buildScene, DEFAULT_PORTAL_CONFIG } from "@suite/scene";
import { boardMiniature } from "../canvas/portalMiniature";
import { SceneLayer } from "./SceneLayer";

const noteType: CardType = {
  id: "note",
  name: "Note",
  glyph: "\u25a1",
  createdAt: 0,
  updatedAt: 0,
  fields: [
    { id: "owner", name: "Owner", kind: "text", required: false, order: 0, options: [] },
    { id: "status", name: "Status", kind: "text", required: false, order: 1, options: [] },
  ],
};

const tags = new Map<string, Tag>([
  ["research", { id: "research", name: "research", createdAt: 0 }],
]);

function card(id: string, properties: Card["properties"], tagsOnCard: string[] = []): Card {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    typeIds: ["note"],
    primaryTypeId: "note",
    tags: tagsOnCard,
    properties,
  };
}

const cards = new Map<string, Card>([
  ["root-a", card("root-a", { owner: "Ada", status: "Draft" }, ["research"])],
  ["root-b", card("root-b", { owner: "Grace" })],
  ["root-c", card("root-c", { status: "Review" })],
  ["target-a", card("target-a", { owner: "Linus" }, ["research"])],
  ["target-b", card("target-b", { status: "Final" })],
  ["target-c", card("target-c", { owner: "Barbara" })],
]);

const rootSections: Section[] = [
  {
    id: "root-section",
    boardId: "root",
    title: "Workspace",
    x: -24,
    y: -24,
    width: 300,
    height: 260,
    z: 0,
    color: "blue",
    createdAt: 0,
    updatedAt: 0,
  },
];

const rootPlacements: Placement[] = [
  { boardId: "root", cardId: "root-a", x: 0, y: 0, z: 0, createdAt: 0 },
  { boardId: "root", cardId: "root-b", x: 0, y: 190, z: 1, createdAt: 1 },
  { boardId: "root", cardId: "root-c", x: 260, y: 0, z: 2, createdAt: 2 },
  {
    boardId: "root",
    cardId: "root-portal",
    x: 300,
    y: 190,
    z: 3,
    width: 500,
    height: 420,
    createdAt: 3,
  },
  {
    boardId: "root",
    cardId: "root-tiny",
    x: 0,
    y: 380,
    z: 4,
    width: 80,
    height: 64,
    createdAt: 4,
  },
];

const targetSections: Section[] = [
  {
    id: "target-section",
    boardId: "target",
    title: "Sources",
    x: -20,
    y: -20,
    width: 280,
    height: 240,
    z: 0,
    color: "green",
    createdAt: 0,
    updatedAt: 0,
  },
];

const targetPlacements: Placement[] = [
  { boardId: "target", cardId: "target-a", x: 0, y: 0, z: 0, createdAt: 0 },
  { boardId: "target", cardId: "target-b", x: 0, y: 190, z: 1, createdAt: 1 },
  { boardId: "target", cardId: "target-c", x: 260, y: 0, z: 2, createdAt: 2 },
  {
    boardId: "target",
    cardId: "back-portal",
    x: 300,
    y: 190,
    z: 3,
    width: 288,
    height: 256,
    createdAt: 3,
  },
];

const scene = buildScene({
  boards: [
    { id: "root", name: "Research" },
    { id: "target", name: "Sources" },
  ],
  cards: [
    { id: "root-a", primaryTypeId: "note", properties: {} },
    { id: "root-b", primaryTypeId: "note", properties: {} },
    { id: "root-c", primaryTypeId: "note", properties: {} },
    {
      id: "root-portal",
      primaryTypeId: PORTAL_TYPE_ID,
      properties: { [PORTAL_BOARD_FIELD_ID]: "target" },
    },
    {
      id: "root-tiny",
      primaryTypeId: PORTAL_TYPE_ID,
      properties: { [PORTAL_BOARD_FIELD_ID]: "target" },
    },
    { id: "target-a", primaryTypeId: "note", properties: {} },
    { id: "target-b", primaryTypeId: "note", properties: {} },
    { id: "target-c", primaryTypeId: "note", properties: {} },
    {
      id: "back-portal",
      primaryTypeId: PORTAL_TYPE_ID,
      properties: { [PORTAL_BOARD_FIELD_ID]: "root" },
    },
  ],
  placements: [
    ...rootPlacements.map((placement) => ({
      boardId: placement.boardId,
      cardId: placement.cardId,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      width: placement.width,
      height: placement.height,
    })),
    ...targetPlacements.map((placement) => ({
      boardId: placement.boardId,
      cardId: placement.cardId,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      width: placement.width,
      height: placement.height,
    })),
  ],
  sections: [
    ...rootSections.map((section) => ({
      id: section.id,
      boardId: section.boardId,
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      z: section.z,
      color: section.color,
    })),
    ...targetSections.map((section) => ({
      id: section.id,
      boardId: section.boardId,
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      z: section.z,
      color: section.color,
    })),
  ],
  edges: [
    {
      id: "edge-a-b",
      boardId: "root",
      source: "root-a",
      target: "root-c",
      kind: "references",
      path: "bezier",
    },
  ],
  rootBoardId: "root",
  camera: { x: 0, y: 0, zoom: 1 },
  titles: {
    "root-a": "Field notes",
    "root-b": "Interview plan",
    "root-c": "Open questions",
    "root-portal": "Sources",
    "root-tiny": "Sources (far)",
    "target-a": "Primary source",
    "target-b": "Method",
    "target-c": "Follow-up",
    "back-portal": "Research",
  },
  config: { portal: { ...DEFAULT_PORTAL_CONFIG, dwellMs: 0 } },
});

const miniatures = new Map([
  ["root", boardMiniature(rootSections, rootPlacements)],
  ["target", boardMiniature(targetSections, targetPlacements)],
]);

const meta = {
  title: "Canvas/SceneLayer",
  component: SceneLayer,
  parameters: { layout: "fullscreen" },
  args: {
    scene,
    viewport: { x: -80, y: -80, width: 1200, height: 900 },
    cards,
    types: new Map([[noteType.id, noteType]]),
    tags,
    miniatures,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          width: 1100,
          height: 800,
          overflow: "hidden",
          background: "var(--canvas-bg)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof SceneLayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecursivePortals: Story = {};
