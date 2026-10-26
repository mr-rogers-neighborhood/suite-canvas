import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { expect, screen, userEvent, within } from "storybook/test";
import { HistoryPanel } from "./HistoryPanel";

/** A workspace with a few steps behind it, dated so the times read the same every run. */
function seeded(): { workspace: WorkspaceDocument; olderPointId: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText("c1", "Retrieval beats re-reading");
  const olderPointId = workspace.listHistoryPoints()[0]?.id ?? "";
  workspace.createCard({ id: "c2", boardId: board.id, position: { x: 340, y: 0 } });
  workspace.setTitleText("c2", "Spaced repetition");
  workspace.createCard({ id: "c3", boardId: board.id, position: { x: 680, y: 0 } });
  workspace.setTitleText("c3", "Study plan");
  return { workspace, olderPointId };
}

/** A fixed clock, so "12 mins ago" means the same thing on every run. */
const NOW = Date.UTC(2026, 4, 3, 12, 0, 0);

/** One seeded workspace, so the play function names a point the story shows. */
const run = seeded();

const meta = {
  title: "Canvas/HistoryPanel",
  component: HistoryPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ padding: 16, height: 460 }}>
        <Story />
      </div>
    ),
  ],
  args: { now: NOW },
} satisfies Meta<typeof HistoryPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The list as it opens: every point, the newest marked as the workspace now. */
export const WithHistory: Story = {
  args: { workspace: run.workspace },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("history-panel")).toBeInTheDocument();
    const rows = within(canvas.getByTestId("history-points")).getAllByRole("button");
    await expect(rows.length).toBeGreaterThan(1);
  },
};

/** What restoring would do is on screen before the button that does it. */
export const PreviewBeforeRestore: Story = {
  args: { workspace: run.workspace },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId(`history-point-${run.olderPointId}`);
    await userEvent.click(row);
    const preview = canvas.getByTestId("history-preview");
    await expect(within(preview).getByTestId("history-preview-summary")).toHaveTextContent(
      "Undo puts it back",
    );
    await expect(canvas.getByTestId("history-restore")).toBeEnabled();
    await userEvent.click(canvas.getByTestId("history-cancel"));
    await expect(screen.queryByTestId("history-preview")).toBeNull();
  },
};

/** A workspace that has never been written to has nothing to list. */
export const Empty: Story = {
  args: { workspace: new WorkspaceDocument() },
};
