import type { Card, CardType } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { NodeCard } from "./NodeCard";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("n1").id;

const card: Card = {
  id: "n1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [
    { id: "c-top", x: 0.5, y: 0 },
    { id: "c-right", x: 1, y: 0.5 },
    { id: "c-bottom", x: 0.5, y: 1 },
    { id: "c-left", x: 0, y: 0.5 },
  ],
  typeIds: ["note"],
  primaryTypeId: "note",
  tags: [],
  properties: {},
};

const type: CardType = {
  id: "note",
  name: "Note",
  glyph: "\u25a1",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

const meta = { properties: [], tags: [] };

const base = {
  card,
  type,
  meta,
  cardDoc: doc,
  contentId,
  titleId,
  cursorStore: null,
  localUser: null,
  boardId: "board-1",
};

function renderCard(overrides: Partial<Parameters<typeof NodeCard>[0]> = {}) {
  return render(
    <ReactFlowProvider>
      <NodeCard {...base} {...overrides} />
    </ReactFlowProvider>,
  );
}

describe("NodeCard", () => {
  it("renders a read-only note card", () => {
    renderCard();
    expect(screen.getByTestId("node-card")).toBeInTheDocument();
  });

  it("renders presence avatars for peers on the node", () => {
    renderCard({ presence: [{ name: "Nova", color: "#f97316" }] });
    expect(screen.getByTestId("presence-avatar")).toBeInTheDocument();
  });

  it("opens card info on a click without movement", () => {
    const onOpenInfo = vi.fn();
    renderCard({ onOpenInfo });

    fireEvent.click(screen.getByTestId("node-card"));

    expect(onOpenInfo).toHaveBeenCalledOnce();
  });

  it("starts body editing on a double click", () => {
    const onStartEditing = vi.fn();
    renderCard({ onStartEditing });

    fireEvent.doubleClick(screen.getByTestId("card-body"));

    expect(onStartEditing).toHaveBeenCalledWith("body");
  });

  it("ignores shift, ctrl and meta clicks so multi-select owns them", () => {
    const onOpenInfo = vi.fn();
    renderCard({ onOpenInfo });

    const cardElement = screen.getByTestId("node-card");
    fireEvent.click(cardElement, { shiftKey: true });
    fireEvent.click(cardElement, { ctrlKey: true });
    fireEvent.click(cardElement, { metaKey: true });

    expect(onOpenInfo).not.toHaveBeenCalled();
  });

  it("renders the body read-only when no surface owns it", () => {
    const { container } = renderCard();
    const body = container.querySelector(".node-card-editor");

    expect(body).toHaveAttribute("contenteditable", "false");
  });

  it("hides frontmatter until expanded", () => {
    const onToggleMeta = vi.fn();
    const withMeta = {
      properties: [{ fieldId: "status", label: "Status", value: "Active" }],
      tags: ["Research"],
    };
    const { rerender } = renderCard({ meta: withMeta, onToggleMeta });

    expect(screen.queryByTestId("card-meta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-meta-toggle"));
    expect(onToggleMeta).toHaveBeenCalledOnce();

    rerender(
      <ReactFlowProvider>
        <NodeCard {...base} meta={withMeta} metaExpanded onToggleMeta={onToggleMeta} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("card-meta")).toHaveTextContent("Active");
    expect(screen.getByTestId("card-meta")).toHaveTextContent("#Research");
  });
});

describe("NodeCard organization actions", () => {
  it("lists duplicate and move-to-board before the editing actions", () => {
    renderCard({
      canEditContent: true,
      canEditLayout: true,
      canManageTrash: true,
      onDuplicate: () => {},
      moveTargets: [{ id: "board-2", name: "Ideas" }],
      onMoveToBoard: () => {},
      onTrash: () => {},
    });

    fireEvent.click(screen.getByTestId("card-menu"));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");

    const duplicate = labels.findIndex((label) => label.includes("Duplicate"));
    const move = labels.findIndex((label) => label.includes("Move to board"));
    expect(duplicate).toBeGreaterThanOrEqual(0);
    expect(move).toBe(duplicate + 1);
    expect(move).toBeLessThan(labels.findIndex((label) => label.includes("Edit title")));
    // Destructive work stays last.
    expect(labels.at(-1)).toContain("Delete card");
  });

  it("hides both entries without the callbacks a capability gate would pass", () => {
    renderCard({ canEditContent: true, canEditLayout: true });

    fireEvent.click(screen.getByTestId("card-menu"));

    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move to board" })).not.toBeInTheDocument();
  });
});
