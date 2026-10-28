import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkspaceDocument } from "@suite/graph";
import { WorkspaceDocument as Document } from "@suite/graph";
import { SelectionStylePanel } from "./SelectionStylePanel";

/**
 * The panel exists for a multi-selection, so the fixture seeds three cards that
 * disagree: one shaped, one coloured, one bare. Every row that the cards share reads
 * Mixed, which is the state the panel is for.
 */
function seeded(): { doc: WorkspaceDocument; ids: string[] } {
  const doc = new Document();
  const board = doc.createBoard({ name: "Home" });
  const first = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const second = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  const third = doc.createCard({ boardId: board.id, position: { x: 800, y: 0 } });
  doc.setCardStyle(first.id, { shape: "pill" });
  doc.setCardStyle(second.id, { shape: "diamond", swatch: "rose" });
  return { doc, ids: [first.id, second.id, third.id] };
}

const { doc, ids } = seeded();

const meta = {
  title: "Canvas/SelectionStylePanel",
  component: SelectionStylePanel,
  args: { cardIds: ids, canEdit: true, workspace: doc },
  decorators: [
    (Story: () => React.ReactElement) => (
      <div style={{ position: "relative", height: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SelectionStylePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const ReadOnly: Story = { args: { canEdit: false } };
