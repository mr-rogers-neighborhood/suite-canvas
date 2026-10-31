import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { useEffect } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { ViewsEditor } from "./ViewsEditor";

/**
 * The editor is store-driven and writes only through the document, so a story is a small workspace
 * with one saved view and the sheet opened on a draft.
 */
function workspace(): WorkspaceDocument {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.createBoard({ name: "Home" });
  doc.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  doc.createCard({ id: "c2", boardId: board.id, position: { x: 220, y: 0 } });
  doc.createCard({ id: "c3" });
  doc.createView({
    name: "Grading pass",
    query: {
      typeIds: [],
      tagIds: [],
      sectionIds: [],
      scope: "all",
      groupBySection: false,
      order: "title",
    },
    kind: "collection",
    collection: { mode: "database" },
  });
  return doc;
}

function Editor({ kind, fresh }: { kind: "lens" | "collection" | "render"; fresh: boolean }) {
  useEffect(() => {
    const doc = workspace();
    useCanvasStore.setState({ workspace: doc });
    useUiStore.setState({
      activeBoardId: doc.listBoards()[0]?.id ?? null,
      canManageSchema: true,
      selectedNodeIds: [],
      activeViewId: null,
    });
    const saved = doc.listViews()[0];
    if (fresh || saved === undefined) useViewsStore.getState().openNew(doc.listViews().length);
    else useViewsStore.getState().openView(saved);
    useViewsStore.getState().patch({ kind });
  }, [kind, fresh]);
  return <ViewsEditor />;
}

const meta = {
  title: "Views/ViewsEditor",
  component: Editor,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Editor>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A new view on a board with three cards, two of them placed. */
export const NewView: Story = { args: { kind: "lens", fresh: true } };

/** The same draft as a collection: the presentation step offers a table, a grid or a list. */
export const Collection: Story = { args: { kind: "collection", fresh: true } };

/** A render, where the layout decides between a graph and a chart. */
export const Render: Story = { args: { kind: "render", fresh: true } };

/** Editing a saved view: the rail marks it, and the footer offers Save as copy. */
export const EditingSaved: Story = { args: { kind: "collection", fresh: false } };
