import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { ViewsLayer } from "./ViewsLayer";

function seed() {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.createBoard({ name: "Home" });
  doc.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  doc.createCard({ id: "c2", boardId: board.id, position: { x: 220, y: 0 } });
  doc.createCard({ id: "c3" });
  const view = doc.createView({
    name: "Everything",
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
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({
    activeBoardId: board.id,
    canManageSchema: true,
    selectedNodeIds: [],
  });
  return { doc, board, view };
}

beforeEach(() => {
  useViewsStore.setState({
    open: false,
    editingId: null,
    draft: null,
    contextOpen: false,
    mode: "read",
    drilldown: null,
    hiddenFields: [],
    deleted: null,
    picking: false,
    pickBase: null,
    pendingCardId: null,
  });
  useProjectionStore.setState({ byWorkspace: {} });
});

describe("the views layer", () => {
  it("should draw nothing until it is opened", () => {
    seed();
    render(<ViewsLayer />);
    expect(screen.queryByTestId("views-layer")).toBeNull();
  });

  it("should open on a saved view with its name, rail and presentation", () => {
    const { view, doc } = seed();
    useViewsStore.getState().openLayer(view.id);
    render(<ViewsLayer />);

    expect(screen.getByTestId("views-layer")).toBeInTheDocument();
    expect(screen.getByTestId("views-layer-name")).toHaveValue("Everything");
    expect(screen.getByTestId(`views-layer-rail-${view.id}`)).toBeInTheDocument();
    // Three cards, two on the board: the collection draws every one of them.
    expect(screen.getByTestId("view-surface-table")).toBeInTheDocument();
    expect(screen.getByTestId("views-layer-count")).toHaveTextContent("0 pinned");
    expect(doc.listViews()).toHaveLength(1);
  });

  it("should open to the data, with the controls one press away", () => {
    const { view } = seed();
    useViewsStore.getState().openLayer(view.id);
    render(<ViewsLayer />);

    // Reading is the default: no kind switch, no context toggle, and the context said in one sentence.
    expect(screen.queryByTestId("views-layer-kind-collection")).toBeNull();
    expect(screen.queryByTestId("views-layer-context")).toBeNull();
    expect(screen.getByTestId("views-context-sentence")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("views-layer-mode-edit"));
    expect(screen.getByTestId("views-layer-kind-collection")).toBeInTheDocument();
    expect(screen.getByTestId("views-layer-context")).toBeInTheDocument();
  });

  it("should write the kind to the document as it is chosen", () => {
    const { view, doc } = seed();
    useViewsStore.getState().openLayer(view.id);
    useViewsStore.getState().setMode("edit");
    render(<ViewsLayer />);

    fireEvent.click(screen.getByTestId("views-layer-kind-render"));
    expect(doc.getView(view.id)?.kind).toBe("render");
    expect(doc.getView(view.id)?.collection).toBeUndefined();
  });

  it("should write a query change to the document, not to a draft", () => {
    const { view, doc } = seed();
    useViewsStore.getState().openLayer(view.id);
    useViewsStore.getState().setMode("edit");
    render(<ViewsLayer />);

    fireEvent.click(screen.getByTestId("views-layer-context"));
    fireEvent.change(screen.getByTestId("views-context-text"), { target: { value: "grading" } });
    expect(doc.getView(view.id)?.query.text).toBe("grading");
  });

  it("should project a view and close the layer", () => {
    const { view } = seed();
    useViewsStore.getState().openLayer(view.id);
    render(<ViewsLayer />);

    fireEvent.click(screen.getByTestId("views-layer-project"));
    expect(Object.values(useProjectionStore.getState().byWorkspace)[0]?.viewId).toBe(view.id);
    expect(useViewsStore.getState().open).toBe(false);
  });

  it("should leave the window and project when the reader starts picking", () => {
    const { view } = seed();
    useViewsStore.getState().openLayer(view.id);
    useViewsStore.getState().setMode("edit");
    render(<ViewsLayer />);

    fireEvent.click(screen.getByTestId("views-layer-pick"));
    // The layer is gone, the board is the surface, and the view is cast so the picks show up live.
    expect(screen.queryByTestId("views-layer")).toBeNull();
    expect(useViewsStore.getState().picking).toBe(true);
    expect(useViewsStore.getState().open).toBe(false);
    expect(Object.values(useProjectionStore.getState().byWorkspace)[0]?.viewId).toBe(view.id);
  });

  it("should remember the pins it started from, so a cancel can be exact", () => {
    const { view, doc } = seed();
    doc.addViewPin(view.id, "c1");
    useViewsStore.getState().openLayer(view.id);
    useViewsStore.getState().setMode("edit");
    render(<ViewsLayer />);

    fireEvent.click(screen.getByTestId("views-layer-pick"));
    expect(useViewsStore.getState().pickBase).toEqual(["c1"]);
  });

  it("should create a new view from a draft and stay on it", () => {
    const { doc } = seed();
    useViewsStore.getState().openNew(doc.listViews().length);
    render(<ViewsLayer />);

    fireEvent.change(screen.getByTestId("views-layer-name"), { target: { value: "Mine" } });
    fireEvent.blur(screen.getByTestId("views-layer-name"));
    fireEvent.click(screen.getByTestId("views-layer-create"));

    expect(doc.listViews().map((entry) => entry.name)).toContain("Mine");
    expect(useViewsStore.getState().draft).toBeNull();
    expect(useViewsStore.getState().editingId).not.toBeNull();
  });

  it("should discard the layer's own edits when asked", () => {
    const { view, doc } = seed();
    useViewsStore.getState().openLayer(view.id);
    useViewsStore.getState().setMode("edit");
    render(<ViewsLayer />);

    fireEvent.change(screen.getByTestId("views-layer-name"), { target: { value: "Renamed" } });
    fireEvent.blur(screen.getByTestId("views-layer-name"));
    expect(doc.getView(view.id)?.name).toBe("Renamed");

    fireEvent.click(screen.getByTestId("views-layer-discard"));
    expect(doc.getView(view.id)?.name).toBe("Everything");
  });

  it("should offer no Create to a reader who may not change the workspace", () => {
    const { doc } = seed();
    useUiStore.setState({ canManageSchema: false });
    useViewsStore.getState().openNew(doc.listViews().length);
    render(<ViewsLayer />);

    expect(screen.getByTestId("views-layer-create")).toBeDisabled();
  });
});
