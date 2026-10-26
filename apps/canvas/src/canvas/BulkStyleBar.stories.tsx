import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { BulkStyleBar } from "./BulkStyleBar";

/**
 * The bar exists for a multi-selection, so the fixture seeds a board with three
 * cards and hands the component the same targets the canvas derives.
 */
const workspace = new WorkspaceDocument();
const board = workspace.createBoard({ name: "Story" });
const cards = [
  workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } }),
  workspace.createCard({ boardId: board.id, position: { x: 320, y: 0 } }),
  workspace.createCard({ boardId: board.id, position: { x: 640, y: 0 } }),
];
workspace.setCardStyle(cards[1]?.id ?? "", { shape: "pill", radius: 16 });
const targets = cards.map((card) => {
  const record = workspace.getCard(card.id);
  return { id: card.id, ...(record?.style ? { style: record.style } : {}) };
});

const meta = {
  title: "Canvas/BulkStyleBar",
  component: BulkStyleBar,
  parameters: { layout: "fullscreen" },
  args: { targets, canEdit: true, workspace },
  decorators: [
    (Story) => (
      <div className="relative h-64 w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof BulkStyleBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedSelection: Story = {};

export const ReadOnly: Story = { args: { canEdit: false } };
