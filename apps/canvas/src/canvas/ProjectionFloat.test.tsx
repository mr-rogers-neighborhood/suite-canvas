import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectionFloat } from "../canvas/ProjectionFloat";
import { useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";

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
  useViewsStore.setState({
    open: false,
    editingId: null,
    draft: null,
    picking: false,
    pickBase: null,
    mode: "read",
    drilldown: null,
    hiddenFields: [],
    deleted: null,
  });
});

describe("the projection float", () => {
  it("should draw nothing when nothing is projected", () => {
    seed();
    useProjectionStore.getState().stop();
    render(<ProjectionFloat />);
    expect(screen.queryByTestId("projection-float")).toBeNull();
  });

  it("should name the view, count this board, and offer the boards the rest sit on", () => {
    const { home, archive } = seed();
    render(<ProjectionFloat />);

    expect(screen.getByTestId("projection-float-name")).toHaveTextContent("Everything");
    expect(screen.getByTestId(`projection-float-board-${home.id}`)).toHaveTextContent(/Home\s*1/);
    expect(screen.getByTestId(`projection-float-board-${archive.id}`)).toHaveTextContent(
      /Archive\s*1/,
    );
    expect(screen.getByTestId(`projection-float-board-${home.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("should count inbox cards without pretending they are on a board", () => {
    seed();
    render(<ProjectionFloat />);
    expect(screen.getByTestId("projection-float-inbox")).toHaveTextContent("1 in the inbox");
  });

  it("should switch board from a chip, keeping the projection", () => {
    const { archive, view } = seed();
    render(<ProjectionFloat />);

    fireEvent.click(screen.getByTestId(`projection-float-board-${archive.id}`));
    expect(useUiStore.getState().activeBoardId).toBe(archive.id);
    expect(
      useProjectionStore.getState().byWorkspace[
        Object.keys(useProjectionStore.getState().byWorkspace)[0] ?? ""
      ]?.viewId,
    ).toBe(view.id);
  });

  it("should toggle the two projection switches, because they describe how this reader reads", () => {
    seed();
    render(<ProjectionFloat />);

    fireEvent.click(screen.getByTestId("projection-float-outline"));
    fireEvent.click(screen.getByTestId("projection-float-fade"));
    const projection = Object.values(useProjectionStore.getState().byWorkspace)[0];
    expect(projection?.outline).toBe(false);
    expect(projection?.fade).toBe(false);
  });

  it("should stop projecting and open the layer from the float", () => {
    const { view } = seed();
    render(<ProjectionFloat />);

    fireEvent.click(screen.getByTestId("projection-float-open"));
    expect(useViewsStore.getState().editingId).toBe(view.id);
    expect(useViewsStore.getState().open).toBe(true);
  });

  it("should carry the pick, so building a context and reading it are one surface", () => {
    const { view } = seed();
    useViewsStore.setState({ picking: true, pickBase: [] });
    render(<ProjectionFloat />);

    expect(screen.getByTestId("projection-float-picking")).toHaveTextContent("Picking");
    fireEvent.click(screen.getByTestId("views-picking-done"));
    expect(useViewsStore.getState().picking).toBe(false);
    // Done returns to the layer the pick was for, not to the board.
    expect(useViewsStore.getState().editingId).toBe(view.id);
    expect(useViewsStore.getState().open).toBe(true);
  });

  it("should put back exactly the pins Cancel drops", () => {
    const { doc, view } = seed();
    doc.addViewPin(view.id, "c1");
    useViewsStore.setState({ picking: true, pickBase: [] });
    render(<ProjectionFloat />);

    doc.addViewPin(view.id, "c2");
    fireEvent.click(screen.getByTestId("views-picking-cancel"));
    // Cleared pins are an absent context rather than an empty list, which is what a cancel restores.
    expect(doc.getView(view.id)?.context?.cardIds ?? []).toEqual([]);
    expect(useViewsStore.getState().picking).toBe(false);
  });

  it("should remember the corner it was dragged to, so it comes back there", () => {
    seed();
    useProjectionStore.getState().setCorner({ x: 120, y: 240 });
    render(<ProjectionFloat />);
    expect(screen.getByTestId("projection-float")).toHaveStyle({ left: "120px", top: "240px" });
  });

  it("should stop projecting when asked, which is this reader's own state", () => {
    seed();
    render(<ProjectionFloat />);

    fireEvent.click(screen.getByTestId("projection-float-stop"));
    expect(Object.keys(useProjectionStore.getState().byWorkspace)).toEqual([]);
  });
});
