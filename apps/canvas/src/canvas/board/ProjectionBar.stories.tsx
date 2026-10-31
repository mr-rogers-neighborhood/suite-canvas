import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { useEffect } from "react";
import { useProjectionStore } from "../../store/projectionStore";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { ProjectionBar } from "./ProjectionBar";

/**
 * The bar names the view projected onto this board and, when the view's context reaches other boards,
 * offers a chip for each. It is reader state: the store below stands in for a browser that cast its
 * own view.
 */
function Bar({ name }: { name: string }) {
  useEffect(() => {
    const doc = new WorkspaceDocument();
    doc.ensureDefaultTypes();
    const home = doc.createBoard({ name: "Home" });
    const archive = doc.createBoard({ name: "Archive" });
    doc.createCard({ id: "c1", boardId: home.id, position: { x: 0, y: 0 } });
    doc.createCard({ id: "c2", boardId: archive.id, position: { x: 0, y: 0 } });
    const view = doc.createView({
      name,
      query: {
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "title",
      },
    });
    useCanvasStore.setState({ workspace: doc });
    useUiStore.setState({ activeBoardId: home.id });
    useProjectionStore.getState().project(view.id);
  }, [name]);
  return (
    <div style={{ position: "relative", height: 320 }}>
      <ProjectionBar />
    </div>
  );
}

const meta = {
  title: "Views/ProjectionBar",
  component: Bar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Bar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A projection whose context sits on two boards: one chip for the board you are on, one for the other. */
export const TwoBoards: Story = { args: { name: "Everything" } };

/** A name long enough to test that the bar truncates rather than pushing the chips off the row. */
export const LongName: Story = {
  args: { name: "Every promoted card with a due date from the last two quarters" },
};
