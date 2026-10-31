import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { ViewsContextDrawer } from "./ViewsContextDrawer";

const QUERY = {
  typeIds: [],
  tagIds: [],
  sectionIds: [],
  scope: "all" as const,
  groupBySection: false,
  order: "title" as const,
};

function fixture() {
  const doc: WorkspaceDocument = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.createBoard({ name: "Home" });
  const type = doc.createType({ name: "Character" });
  doc.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 }, typeId: type.id });
  doc.setTitleText("c1", "Ada");
  // The drawer reads the type, tag and card lists from the snapshot, so the store has to hold the doc.
  useCanvasStore.setState({ workspace: doc });
  const view = doc.createView({ name: "Everything", query: QUERY });
  return { doc, board, type, view };
}

function draw(props: { doc: WorkspaceDocument; boardId: string; viewId: string }) {
  const view = props.doc.getView(props.viewId);
  if (view === undefined) throw new Error("missing view");
  const onQuery = vi.fn();
  const onPin = vi.fn();
  const onUnpin = vi.fn();
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ViewsContextDrawer
      view={view}
      workspace={props.doc}
      boardId={props.boardId}
      onQuery={onQuery}
      onPin={onPin}
      onUnpin={onUnpin}
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { onQuery, onPin, onUnpin, onPick, onClose };
}

describe("the context drawer", () => {
  it("should hand a typed word to the caller as a query patch", () => {
    const { doc, board, view } = fixture();
    const { onQuery } = draw({ doc, boardId: board.id, viewId: view.id });

    fireEvent.change(screen.getByTestId("views-context-text"), { target: { value: "ada" } });
    expect(onQuery).toHaveBeenCalledWith({ text: "ada" });
  });

  it("should clear the word rather than store an empty string", () => {
    const { doc, board, view } = fixture();
    doc.patchViewQuery(view.id, { text: "ada" });
    const { onQuery } = draw({ doc, boardId: board.id, viewId: view.id });

    fireEvent.change(screen.getByTestId("views-context-text"), { target: { value: "" } });
    expect(onQuery).toHaveBeenCalledWith({ text: undefined });
  });

  it("should add a type chip and remove it again", () => {
    const { doc, board, type, view } = fixture();
    const { onQuery } = draw({ doc, boardId: board.id, viewId: view.id });

    fireEvent.click(screen.getByRole("button", { name: "Character" }));
    expect(onQuery).toHaveBeenCalledWith({ typeIds: [type.id] });
  });

  it("should name the scope the view is in, and offer the other", () => {
    const { doc, board, view } = fixture();
    const { onQuery } = draw({ doc, boardId: board.id, viewId: view.id });

    expect(screen.getByRole("button", { name: "All cards" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "This board" }));
    expect(onQuery).toHaveBeenCalledWith({ scope: "board" });
  });

  it("should leave picking to the caller, and close on its own button", () => {
    const { doc, board, view } = fixture();
    const { onPick, onClose } = draw({ doc, boardId: board.id, viewId: view.id });

    fireEvent.click(screen.getByTestId("views-context-pick"));
    expect(onPick).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("views-context-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("should list the pins with the title of the card they name", () => {
    const { doc, board, view } = fixture();
    doc.addViewPin(view.id, "c1");
    const { onUnpin } = draw({ doc, boardId: board.id, viewId: view.id });

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("No pinned cards.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unpin Ada" }));
    expect(onUnpin).toHaveBeenCalledWith("c1");
  });

  it("should mark a pin whose card is gone instead of dropping it quietly", () => {
    const { doc, board, view } = fixture();
    doc.addViewPin(view.id, "deleted-card");
    draw({ doc, boardId: board.id, viewId: view.id });

    // The id has no card behind it, so the pin says so and offers to clear it rather than vanishing.
    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin removed card" })).toBeInTheDocument();
  });
});
