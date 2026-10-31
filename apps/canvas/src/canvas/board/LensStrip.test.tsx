import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { LensStrip } from "./LensStrip";

function seed(query: { typeIds?: string[] } = {}) {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const home = doc.createBoard({ name: "Home" });
  const archive = doc.createBoard({ name: "Archive" });
  doc.createCard({ id: "c1", boardId: home.id, position: { x: 0, y: 0 } });
  doc.createCard({ id: "c2", boardId: archive.id, position: { x: 0, y: 0 } });
  doc.createCard({ id: "c3" });
  const view = doc.createView({
    name: "Everything",
    query: {
      typeIds: query.typeIds ?? [],
      tagIds: [],
      sectionIds: [],
      scope: "all",
      groupBySection: false,
      order: "title",
    },
  });
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({ activeBoardId: home.id, activeViewId: view.id });
  return { doc, home, archive, view };
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

describe("the lens strip", () => {
  it("should draw nothing when no view is applied", () => {
    seed();
    useUiStore.setState({ activeViewId: null });
    render(<LensStrip />);
    expect(screen.queryByTestId("lens-strip")).toBeNull();
  });

  it("should name the view, count this board, and offer the boards the rest sit on", () => {
    const { home, archive } = seed();
    render(<LensStrip />);

    expect(screen.getByTestId("lens-strip-name")).toHaveTextContent("Everything");
    expect(screen.getByTestId(`lens-strip-board-${home.id}`)).toHaveTextContent("Home · 1");
    expect(screen.getByTestId(`lens-strip-board-${archive.id}`)).toHaveTextContent("Archive · 1");
    expect(screen.getByTestId(`lens-strip-board-${home.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("should count cards in the inbox without pretending they are on a board", () => {
    seed();
    render(<LensStrip />);
    expect(screen.getByTestId("lens-strip-inbox")).toHaveTextContent("1 in the inbox");
  });

  it("should switch board from a chip, keeping the lens", () => {
    const { archive } = seed();
    render(<LensStrip />);

    fireEvent.click(screen.getByTestId(`lens-strip-board-${archive.id}`));
    expect(useUiStore.getState().activeBoardId).toBe(archive.id);
    expect(useUiStore.getState().activeViewId).not.toBeNull();
  });

  it("should clear the lens and the view together", () => {
    seed();
    render(<LensStrip />);

    fireEvent.click(screen.getByTestId("lens-strip-clear"));
    expect(useUiStore.getState().activeViewId).toBeNull();
    expect(useViewsStore.getState().draft).toBeNull();
  });

  it("should say Preview while a draft is applied, and offer the way back to the editor", () => {
    seed();
    useViewsStore.setState({
      draft: {
        sourceId: null,
        name: "Draft",
        query: {
          typeIds: [],
          tagIds: [],
          sectionIds: [],
          scope: "all",
          groupBySection: false,
          order: "title",
        },
        cardIds: [],
        kind: "lens",
        lens: {},
        collection: { mode: "database" },
        render: { layout: "graph-2d", measure: { of: "count" } },
      },
      editorOpen: false,
      preview: true,
    });
    render(<LensStrip />);

    expect(screen.getByTestId("lens-strip-name")).toHaveTextContent("Preview · Draft");
    fireEvent.click(screen.getByTestId("lens-strip-edit"));
    expect(useViewsStore.getState().editorOpen).toBe(true);
  });
});
