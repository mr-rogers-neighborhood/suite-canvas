import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { ViewPresentation } from "./ViewPresentation";

function seed(kind: "collection" | "render", mode: "database" | "grid" = "database") {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.createBoard({ name: "Home" });
  doc.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  doc.createCard({ id: "c2", boardId: board.id, position: { x: 200, y: 0 } });
  const view = doc.createView({
    name: "Report",
    query: {
      typeIds: [],
      tagIds: [],
      sectionIds: [],
      scope: "all",
      groupBySection: false,
      order: "title",
    },
    kind,
    ...(kind === "collection" ? { collection: { mode } } : { render: { layout: "graph-2d" } }),
  });
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({ activeBoardId: board.id });
  useViewsStore.setState({ presented: view.id });
  return { doc, view };
}

beforeEach(() => {
  useViewsStore.setState({
    draft: null,
    editorOpen: false,
    preview: true,
    presented: null,
    previous: null,
    pendingCardId: null,
  });
});

describe("the view presentation", () => {
  it("should draw nothing until a view is presented", () => {
    seed("collection");
    useViewsStore.setState({ presented: null });
    render(<ViewPresentation />);
    expect(screen.queryByTestId("view-presentation")).toBeNull();
  });

  it("should name the view and count its cards", () => {
    seed("collection");
    render(<ViewPresentation />);

    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByTestId("view-presentation-count")).toHaveTextContent("2 cards");
  });

  it("should draw a collection as a table, a grid or a list by its mode", () => {
    const { doc, view } = seed("collection");
    render(<ViewPresentation />);
    expect(screen.getAllByTestId("view-presentation-card")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();

    doc.updateView(view.id, { kind: "collection", collection: { mode: "grid" } });
    render(<ViewPresentation />);
    expect(screen.getAllByTestId("view-presentation-card")).toHaveLength(4);
  });

  it("should draw a render with the same figure a card shows", () => {
    seed("render");
    render(<ViewPresentation />);
    expect(screen.getByTestId("view-figure-render")).toBeInTheDocument();
  });

  it("should close back to the board", () => {
    seed("collection");
    render(<ViewPresentation />);

    fireEvent.click(screen.getByTestId("view-presentation-close"));
    expect(useViewsStore.getState().presented).toBeNull();
  });
});
