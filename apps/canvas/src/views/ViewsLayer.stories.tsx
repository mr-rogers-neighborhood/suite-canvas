import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { useEffect } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { ViewsLayer } from "./ViewsLayer";

/**
 * The layer is a mode over the whole window and it reads its subject from the document, so a story is a
 * small workspace plus the store state that opens it: on a saved collection, on a render, on a pick, or
 * on a view that does not exist yet.
 */
function workspace(): WorkspaceDocument {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.createBoard({ name: "Home" });
  const type = doc.listTypes()[0];
  const typeId = type === undefined ? {} : { typeId: type.id };
  doc.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 }, ...typeId });
  doc.createCard({ id: "c2", boardId: board.id, position: { x: 220, y: 0 }, ...typeId });
  doc.createCard({ id: "c3", ...typeId });
  doc.createCard({ id: "c4" });
  return doc;
}

type Opened = "collection" | "render" | "picking" | "new" | "empty";

function Layer({ opened }: { opened: Opened }) {
  useEffect(() => {
    const doc = workspace();
    useCanvasStore.setState({ workspace: doc });
    useUiStore.setState({
      activeBoardId: doc.listBoards()[0]?.id ?? null,
      canManageSchema: true,
      selectedNodeIds: [],
    });
    const store = useViewsStore.getState();
    const collection = doc.createView({
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
    if (opened !== "empty") {
      doc.createView({
        name: "By type",
        query: {
          typeIds: [],
          tagIds: [],
          sectionIds: [],
          scope: "all",
          groupBySection: false,
          order: "title",
        },
        kind: "render",
        render: { layout: "bar", measure: { of: "count" }, groupBy: "type" },
      });
    }
    if (opened === "new") store.openNew(2);
    else if (opened === "empty") store.openLayer(null);
    else {
      store.openLayer(collection.id);
      if (opened === "picking") store.startPicking([]);
    }
  }, [opened]);
  return <ViewsLayer />;
}

const meta = {
  title: "Views/ViewsLayer",
  component: Layer,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Layer>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A saved collection: the rail of thumbnails, the editable table, and the context beside it. */
export const Collection: Story = { args: { opened: "collection" } };

/** The same board read as a chart, with the layout, measure and grouping controls above it. */
export const Render: Story = { args: { opened: "render" } };

/** Picking: the layer is out of the way and the board is the surface. */
export const Picking: Story = { args: { opened: "picking" } };

/** A new view before its first Create: a local draft, with its context drawer already open. */
export const NewView: Story = { args: { opened: "new" } };

/** No saved views at all, which is the one state that has to explain what a view is. */
export const Empty: Story = { args: { opened: "empty" } };
