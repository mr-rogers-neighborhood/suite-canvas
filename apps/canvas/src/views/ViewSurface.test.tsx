import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewSurface } from "./ViewSurface";

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
  const rating = doc.addField(type.id, { name: "Rating", kind: "number" });
  const status = doc.addField(type.id, { name: "Status", kind: "text" });
  doc.createCard({
    id: "c1",
    boardId: board.id,
    position: { x: 0, y: 0 },
    typeId: type.id,
  });
  doc.setTitleText("c1", "Ada");
  doc.setProperty("c1", status.id, "draft");
  doc.setProperty("c1", rating.id, 3);
  const view = (kind?: "collection" | "render") =>
    doc.createView({ name: "Everything", query: QUERY, ...(kind === undefined ? {} : { kind }) });
  return { doc, board, type, rating, status, view };
}

describe("the view surface", () => {
  it("should say so when the context selects nothing", () => {
    const { doc, board, view } = fixture();
    doc.trashCard("c1");
    render(<ViewSurface view={view()} workspace={doc} boardId={board.id} />);
    expect(screen.getByTestId("view-surface-empty")).toBeInTheDocument();
  });

  it("should draw a collection as a table with the card's type and values", () => {
    const { doc, board, view } = fixture();
    render(<ViewSurface view={view("collection")} workspace={doc} boardId={board.id} />);

    expect(screen.getByTestId("view-surface-table")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Character")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("draft");
    expect(screen.getByLabelText("Rating")).toHaveValue(3);
  });

  it("should write a text cell on Enter, not on every keystroke", () => {
    const { doc, board, status, view } = fixture();
    render(<ViewSurface view={view("collection")} workspace={doc} boardId={board.id} />);
    const cell = screen.getByLabelText("Status");

    fireEvent.change(cell, { target: { value: "final" } });
    // Typing is local until the cell is committed, so a cell edit is one write and one undo step.
    expect(doc.getCard("c1")?.properties[status.id]).toBe("draft");
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(doc.getCard("c1")?.properties[status.id]).toBe("final");
  });

  it("should write a number cell as a number", () => {
    const { doc, board, rating, view } = fixture();
    render(<ViewSurface view={view("collection")} workspace={doc} boardId={board.id} />);
    const cell = screen.getByLabelText("Rating");

    fireEvent.change(cell, { target: { value: "5" } });
    fireEvent.blur(cell);
    expect(doc.getCard("c1")?.properties[rating.id]).toBe(5);
  });

  it("should leave a field kind it cannot edit to the inspector", () => {
    const { doc, board, type, view } = fixture();
    doc.addField(type.id, { name: "Related", kind: "date" });
    render(<ViewSurface view={view("collection")} workspace={doc} boardId={board.id} />);

    expect(screen.queryByLabelText("Related")).toBeNull();
    expect(screen.getByText("Related: —")).toBeInTheDocument();
  });

  it("should draw a grid or a list when the collection asks for one", () => {
    const { doc, board, view } = fixture();
    const collection = doc.createView({
      name: "Grid",
      query: QUERY,
      kind: "collection",
      collection: { mode: "grid" },
    });
    const { unmount } = render(
      <ViewSurface view={collection} workspace={doc} boardId={board.id} />,
    );
    expect(screen.getByTestId("view-surface-grid")).toBeInTheDocument();
    unmount();

    doc.patchViewCollection(collection.id, { mode: "list" });
    render(
      <ViewSurface
        view={doc.getView(collection.id) ?? view()}
        workspace={doc}
        boardId={board.id}
      />,
    );
    expect(screen.getByTestId("view-surface-list")).toBeInTheDocument();
  });

  it("should draw a chart for a render that is not a graph", () => {
    const { doc, board } = fixture();
    const render_ = doc.createView({
      name: "By type",
      query: QUERY,
      kind: "render",
      render: { layout: "bar", measure: { of: "count" }, groupBy: "type" },
    });
    render(<ViewSurface view={render_} workspace={doc} boardId={board.id} />);
    expect(screen.getByTestId("view-surface-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("view-surface-table")).toBeNull();
  });

  it("should open a card when the reader presses its name", () => {
    const { doc, board, view } = fixture();
    const onOpenCard = vi.fn();
    render(
      <ViewSurface view={view()} workspace={doc} boardId={board.id} onOpenCard={onOpenCard} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ada" }));
    expect(onOpenCard).toHaveBeenCalledWith("c1");
  });
});
