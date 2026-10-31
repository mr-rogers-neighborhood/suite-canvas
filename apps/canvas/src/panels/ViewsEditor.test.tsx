import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { ViewsEditor } from "./ViewsEditor";

function seed() {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.createBoard({ name: "Home" });
  doc.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  doc.createCard({ id: "c2", boardId: board.id, position: { x: 200, y: 0 } });
  doc.createCard({ id: "c3" });
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({
    activeBoardId: board.id,
    selectedNodeIds: [],
    canManageSchema: true,
    activeViewId: null,
  });
  return { doc, board };
}

beforeEach(() => {
  useViewsStore.setState({
    draft: null,
    editorOpen: false,
    preview: true,
    presented: null,
    previous: null,
  });
});

describe("the views editor", () => {
  it("should draw nothing until it is opened", () => {
    seed();
    render(<ViewsEditor />);
    expect(screen.queryByTestId("views-editor")).toBeNull();
  });

  it("should open on a new view with the three steps and a live preview", () => {
    seed();
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    expect(screen.getByTestId("views-editor")).toBeInTheDocument();
    expect(screen.getByText("1 · Context")).toBeInTheDocument();
    expect(screen.getByText("2 · Kind")).toBeInTheDocument();
    expect(screen.getByText("3 · Presentation")).toBeInTheDocument();
    expect(screen.getByTestId("views-editor-preview")).toHaveAttribute("aria-pressed", "true");
    expect(useViewsStore.getState().preview).toBe(true);
  });

  it("should save a view with its kind, its pins and its presentation", () => {
    const { doc } = seed();
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    fireEvent.change(screen.getByTestId("views-editor-name"), { target: { value: "Pinned" } });
    fireEvent.click(screen.getByTestId("views-editor-kind-collection"));
    fireEvent.click(screen.getByTestId("views-editor-save"));

    const [view] = doc.listViews();
    expect(view?.name).toBe("Pinned");
    expect(view?.kind).toBe("collection");
    expect(view?.collection?.mode).toBe("database");
    // Saving applies it and stops being a draft.
    expect(useUiStore.getState().activeViewId).toBe(view?.id);
    expect(useViewsStore.getState().draft).toBeNull();
    expect(screen.queryByTestId("views-editor")).toBeNull();
  });

  it("should count the context, its pins and its boards", () => {
    seed();
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    // Three cards: two on the board, one in the inbox.
    const readout = screen.getByTestId("views-editor-readout");
    expect(readout.textContent).toContain("3 cards");
    expect(readout.textContent).toContain("1 in the inbox");
  });

  it("should pull the canvas selection in as pins", () => {
    seed();
    useUiStore.setState({ selectedNodeIds: ["c1", "c3"] });
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    fireEvent.click(screen.getByTestId("views-editor-use-selection"));
    expect(useViewsStore.getState().draft?.cardIds).toEqual(["c1", "c3"]);
    expect(screen.getByTestId("views-editor-readout").textContent).toContain("2 pinned");
  });

  it("should mark a draft as unsaved as soon as it differs from what is stored", () => {
    const { doc } = seed();
    const saved = doc.createView({
      name: "Saved",
      query: {
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "title",
      },
    });
    useViewsStore.getState().openView(saved);
    render(<ViewsEditor />);

    expect(screen.queryByTestId("views-editor-dirty")).toBeNull();
    fireEvent.change(screen.getByTestId("views-editor-name"), { target: { value: "Renamed" } });
    expect(screen.getByTestId("views-editor-dirty")).toBeInTheDocument();
  });

  it("should close without discarding when the sheet is dismissed, so the preview stays live", () => {
    seed();
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    fireEvent.click(screen.getByTestId("views-editor-close"));
    expect(screen.queryByTestId("views-editor")).toBeNull();
    // The draft survives the sheet: the preview is what the reader is looking at.
    expect(useViewsStore.getState().draft).not.toBeNull();
    expect(useViewsStore.getState().preview).toBe(true);
  });

  it("should discard the draft and restore what was applied on Cancel", () => {
    const { doc } = seed();
    const saved = doc.createView({
      name: "Saved",
      query: {
        typeIds: [],
        tagIds: [],
        sectionIds: [],
        scope: "all",
        groupBySection: false,
        order: "title",
      },
    });
    useUiStore.setState({ activeViewId: saved.id });
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    fireEvent.click(screen.getByTestId("views-editor-cancel"));
    expect(useViewsStore.getState().draft).toBeNull();
    expect(useUiStore.getState().activeViewId).toBe(saved.id);
  });

  it("should offer no Save to a reader who may not change the workspace", () => {
    seed();
    useUiStore.setState({ canManageSchema: false });
    useViewsStore.getState().openNew(0);
    render(<ViewsEditor />);

    expect(screen.getByTestId("views-editor-save")).toBeDisabled();
  });
});
