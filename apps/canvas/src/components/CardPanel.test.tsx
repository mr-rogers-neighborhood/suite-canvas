import type { Card, CardFieldView, CardType, FieldDefinition } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { CardPanel, type CardPanelProps, type CardWhere } from "./CardPanel";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("n1").id;

const owner: FieldDefinition = {
  id: "owner",
  name: "Owner",
  kind: "text",
  required: false,
  order: 0,
  options: [],
};

const type: CardType = {
  id: "project",
  name: "Project",
  glyph: "P",
  createdAt: 0,
  updatedAt: 0,
  fields: [owner],
};

const card: Card = {
  id: "n1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["project"],
  primaryTypeId: "project",
  tags: [],
  properties: {},
};

const fields: CardFieldView[] = [{ typeId: "project", field: owner }];

const where: CardWhere = {
  unplaced: false,
  entries: [
    {
      boardId: "board-1",
      boardName: "Research",
      isHome: true,
      isCurrent: true,
      sectionPath: [
        { id: "section-1", name: "Timelines" },
        { id: "section-2", name: "Drafts", color: "var(--section-blue)" },
      ],
    },
    {
      boardId: "board-2",
      boardName: "Drafts",
      isHome: false,
      isCurrent: false,
      sectionPath: [],
    },
  ],
};

const base: CardPanelProps = {
  card,
  title: "Mastering the timeline",
  types: [type],
  tags: [],
  fields,
  where,
  editing: null,
  cardDoc: doc,
  contentId,
  titleId,
  cursorStore: null,
  localUser: null,
  peers: [],
  onStartEditing: () => {},
  onEditEnd: () => {},
  onSetType: () => {},
  onAddTag: () => {},
  onRemoveTag: () => {},
  onCreateTag: () => {},
  onSetProperty: () => {},
  onClearProperty: () => {},
  onManageTypes: () => {},
  onFocusCard: () => {},
  onFocusSection: () => {},
  onRemoveFromBoard: () => {},
};

function renderPanel(overrides: Partial<CardPanelProps> = {}) {
  return render(<CardPanel {...base} {...overrides} />);
}

function bodyEditor(container: HTMLElement): HTMLElement {
  const element = container.querySelector(".card-panel-body .node-card-editor");
  if (!element) throw new Error("body editor not mounted");
  return element as HTMLElement;
}

describe("CardPanel", () => {
  it("starts title editing when the read-only title is clicked", () => {
    const onStartEditing = vi.fn();
    renderPanel({ onStartEditing });

    fireEvent.click(screen.getByTestId("card-panel-title"));

    expect(onStartEditing).toHaveBeenCalledWith("title");
  });

  it("starts body editing when the read-only body is clicked", () => {
    const onStartEditing = vi.fn();
    const { container } = renderPanel({ onStartEditing });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
    fireEvent.click(screen.getByTestId("card-panel-body"));

    expect(onStartEditing).toHaveBeenCalledWith("body");
  });

  it("keeps the body read-only while the title owns the surface", () => {
    const { container } = renderPanel({ editing: "title" });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
    expect(container.querySelector(".card-title-editor")).toHaveAttribute(
      "contenteditable",
      "true",
    );
  });

  it("makes the body editable when the panel owns it", () => {
    const { container } = renderPanel({ editing: "body" });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "true");
  });

  it("commits a property edit on blur", () => {
    const onSetProperty = vi.fn();
    renderPanel({ onSetProperty });

    const input = screen.getByLabelText("Owner");
    fireEvent.change(input, { target: { value: "Ada Lovelace" } });
    fireEvent.blur(input);

    expect(onSetProperty).toHaveBeenCalledWith("owner", "Ada Lovelace");
  });

  it("commits the title on Enter", () => {
    const onEditEnd = vi.fn();
    const { container } = renderPanel({ editing: "title", onEditEnd });

    const title = container.querySelector(".card-title-editor");
    if (!title) throw new Error("title editor not mounted");
    fireEvent.keyDown(title, { key: "Enter" });

    expect(onEditEnd).toHaveBeenCalled();
  });

  it("renders the Where breadcrumbs and other boards", () => {
    const onFocusSection = vi.fn();
    const onFocusCard = vi.fn();
    renderPanel({ onFocusSection, onFocusCard });

    expect(screen.getByTestId("inspector-section")).toHaveTextContent("Drafts");
    fireEvent.click(screen.getByTestId("inspector-section"));
    expect(onFocusSection).toHaveBeenCalledWith("section-2");

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(onFocusCard).toHaveBeenCalledWith("board-1");

    expect(screen.getByTestId("inspector-boards").querySelectorAll("li")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onFocusCard).toHaveBeenCalledWith("board-2");
  });

  it("shows the inbox state for an unplaced card", () => {
    renderPanel({ where: { unplaced: true, entries: [] } });

    expect(screen.getByTestId("card-where-empty")).toHaveTextContent("In the inbox");
    expect(screen.queryByTestId("inspector-boards")).not.toBeInTheDocument();
  });

  it("labels a peer editing the body", () => {
    renderPanel({
      peers: [
        {
          clientId: "peer-a",
          board: "board-1",
          user: { name: "Nova", color: "#f97316" },
          pointer: null,
          focus: { nodeId: "n1", field: "body" },
          dragging: null,
          selection: null,
          connector: null,
          resizing: null,
          sectionDrag: null,
          sectionResize: null,
          reconnect: null,
          connect: null,
        },
      ],
    });

    expect(screen.getByTestId("peer-name-tag")).toHaveTextContent("Nova");
  });
});
