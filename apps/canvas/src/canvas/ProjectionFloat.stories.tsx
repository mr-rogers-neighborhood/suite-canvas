import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { useEffect } from "react";
import { useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { ProjectionFloat } from "./ProjectionFloat";

/**
 * The float is reader state, so a story is a small workspace with a view cast over it. It sits where the
 * reader last put it, which is what the two arguments here stand in for.
 */
function Float({ name, picking }: { name: string; picking: boolean }) {
  useEffect(() => {
    const doc = new WorkspaceDocument();
    doc.ensureDefaultTypes();
    const home = doc.createBoard({ name: "Home" });
    const archive = doc.createBoard({ name: "Archive" });
    doc.createCard({ id: "c1", boardId: home.id, position: { x: 0, y: 0 } });
    doc.createCard({ id: "c2", boardId: archive.id, position: { x: 0, y: 0 } });
    doc.createCard({ id: "c3" });
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
    useProjectionStore.getState().setCorner({ x: 32, y: 32 });
    if (picking) {
      useViewsStore.setState({ picking: true, pickBase: [], editingId: view.id });
    }
  }, [name, picking]);
  return (
    <div style={{ position: "relative", height: 260 }}>
      <ProjectionFloat />
    </div>
  );
}

const meta = {
  title: "Views/ProjectionFloat",
  component: Float,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Float>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A projection whose context sits on two boards: one chip for the board you are on, one for the other. */
export const TwoBoards: Story = { args: { name: "Everything", picking: false } };

/** Picking: the same float, saying what is being built and how to stop. */
export const Picking: Story = { args: { name: "Everything", picking: true } };

/** A name long enough to test that the float wraps rather than pushing its chips off the row. */
export const LongName: Story = {
  args: { name: "Every promoted card with a due date from the last two quarters", picking: false },
};
