import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useViewsStore } from "../store/viewsStore";
import { ViewsBar } from "./ViewsBar";

function seed(projected = false) {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const view = doc.createView({
    name: "Grading pass",
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
  useProjectionStore.setState({ byWorkspace: {} });
  if (projected) useProjectionStore.getState().project(view.id);
  return { doc, view };
}

beforeEach(() => {
  useViewsStore.setState({ open: false, editingId: null, draft: null, picking: false });
  useProjectionStore.setState({ byWorkspace: {} });
});

describe("the views icon", () => {
  it("should open the layer on the projected view, so both surfaces agree", () => {
    const { view } = seed(true);
    render(<ViewsBar />);

    expect(screen.getByTestId("views-menu-button")).toHaveAttribute(
      "aria-label",
      "Views: Grading pass",
    );
    fireEvent.click(screen.getByTestId("views-menu-button"));
    expect(useViewsStore.getState().open).toBe(true);
    expect(useViewsStore.getState().editingId).toBe(view.id);
  });

  it("should open the layer on the first view when nothing is projected", () => {
    const { view } = seed();
    render(<ViewsBar />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    expect(useViewsStore.getState().editingId).toBe(view.id);
  });

  it("should open the layer even with no views, so the layer can make one", () => {
    const doc = new WorkspaceDocument();
    useCanvasStore.setState({ workspace: doc });
    render(<ViewsBar />);

    fireEvent.click(screen.getByTestId("views-menu-button"));
    expect(useViewsStore.getState().open).toBe(true);
    expect(useViewsStore.getState().editingId).toBeNull();
  });
});
