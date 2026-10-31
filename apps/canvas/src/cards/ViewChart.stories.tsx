import type { Meta, StoryObj } from "@storybook/react-vite";
import { type SavedView, WorkspaceDocument } from "@suite/graph";
import { ViewChart } from "./ViewChart";

/** Two boards' worth of cards, typed, so a count over the type has something to draw. */
function workspace(): WorkspaceDocument {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const character = doc.createType({ id: "character", name: "Character" });
  const board = doc.createBoard({ name: "Home" });
  for (let index = 0; index < 5; index += 1) {
    doc.createCard({ boardId: board.id, position: { x: index * 40, y: 0 } });
  }
  doc.createCard({ typeId: character.id, boardId: board.id, position: { x: 240, y: 0 } });
  doc.createCard({ typeId: character.id, boardId: board.id, position: { x: 280, y: 0 } });
  return doc;
}

const view = (layout: "bar" | "line"): SavedView => ({
  id: "v1",
  name: "Cards by type",
  position: 0,
  query: {
    typeIds: [],
    tagIds: [],
    sectionIds: [],
    scope: "all",
    groupBySection: false,
    order: "title",
  },
  kind: "render",
  render: { layout, measure: { of: "count" }, groupBy: "type" },
});

const meta = {
  title: "Cards/ViewChart",
  component: ViewChart,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: "320px", height: "200px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ViewChart>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A count per type, ranked. */
export const Bars: Story = { args: { view: view("bar"), workspace: workspace() } };

/** The same count in authored order, as a line reads. */
export const Line: Story = { args: { view: view("line"), workspace: workspace() } };
