import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectionStore } from "../../store/projectionStore";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { ProjectionBar } from "./ProjectionBar";

function seed() {
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
  return { doc, home, archive, view };
}

beforeEach(() => {
  useProjectionStore.setState({ byWorkspace: {} });
  useViewsStore.setState({ open: false, editingId: null, draft: null, picking: false });
});

describe("the projection bar", () => {
  it("should draw nothing when nothing is projected", () => {
    seed();
    useProjectionStore.getState().stop();
    render(<ProjectionBar />);
    expect(screen.queryByTestId("projection-bar")).toBeNull();
  });

  it("should name the view, count this board, and offer the boards the rest sit on", () => {
    const { home, archive } = seed();
    render(<ProjectionBar />);

    expect(screen.getByTestId("projection-bar-name")).toHaveTextContent("Everything");
    expect(screen.getByTestId(`projection-bar-board-${home.id}`)).toHaveTextContent("Home · 1");
    expect(screen.getByTestId(`projection-bar-board-${archive.id}`)).toHaveTextContent(
      "Archive · 1",
    );
    expect(screen.getByTestId(`projection-bar-board-${home.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("should count inbox cards without pretending they are on a board", () => {
    seed();
    render(<ProjectionBar />);
    expect(screen.getByTestId("projection-bar-inbox")).toHaveTextContent("1 in the inbox");
  });

  it("should switch board from a chip, keeping the projection", () => {
    const { archive, view } = seed();
    render(<ProjectionBar />);

    fireEvent.click(screen.getByTestId(`projection-bar-board-${archive.id}`));
    expect(useUiStore.getState().activeBoardId).toBe(archive.id);
    expect(
      useProjectionStore.getState().byWorkspace[
        Object.keys(useProjectionStore.getState().byWorkspace)[0] ?? ""
      ]?.viewId,
    ).toBe(view.id);
  });

  it("should toggle the two projection switches, because they describe how this reader reads", () => {
    seed();
    render(<ProjectionBar />);

    fireEvent.click(screen.getByTestId("projection-bar-outline"));
    fireEvent.click(screen.getByTestId("projection-bar-fade"));
    const projection = Object.values(useProjectionStore.getState().byWorkspace)[0];
    expect(projection?.outline).toBe(false);
    expect(projection?.fade).toBe(false);
  });

  it("should stop projecting and open the layer from the bar", () => {
    const { view } = seed();
    render(<ProjectionBar />);

    fireEvent.click(screen.getByTestId("projection-bar-open"));
    expect(useViewsStore.getState().editingId).toBe(view.id);
    expect(useViewsStore.getState().open).toBe(true);
  });

  it("should stop projecting when asked, which is this reader's own state", () => {
    seed();
    render(<ProjectionBar />);

    fireEvent.click(screen.getByTestId("projection-bar-stop"));
    expect(Object.keys(useProjectionStore.getState().byWorkspace)).toEqual([]);
  });
});
