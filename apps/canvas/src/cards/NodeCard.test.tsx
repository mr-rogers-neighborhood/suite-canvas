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
  it("folds to its header line and back", () => {
    const onToggleCollapsed = vi.fn();
    renderCard({ collapsed: true, onToggleCollapsed });

    // The body is not merely hidden: it is not mounted, so nothing inside it can
    // hold focus or a caret.
    expect(screen.queryByTestId("card-body")).toBeNull();
    expect(screen.getByTestId("card-fold")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByTestId("card-fold"));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("mounts the body when it is unfolded", () => {
    renderCard({ collapsed: false, onToggleCollapsed: vi.fn() });
    expect(screen.getByTestId("card-body")).toBeInTheDocument();
    expect(screen.getByTestId("card-fold")).toHaveAttribute("aria-expanded", "true");
  });

  it("offers no fold when the surface owns none", () => {
    renderCard();
    expect(screen.queryByTestId("card-fold")).toBeNull();
  });

  it("renders a read-only note card", () => {
    renderCard();
    expect(screen.getByTestId("node-card")).toBeInTheDocument();
  });

  it("paints an off-lens card back without disabling it", () => {
    const onOpenInfo = vi.fn();
    renderCard({ dim: true, onOpenInfo });

    const card = screen.getByTestId("node-card");
    expect(card.className).toContain("is-off-lens");
    // Dimming is a reading aid: the card still opens.
    fireEvent.click(card);
    expect(onOpenInfo).toHaveBeenCalledOnce();
  });

  it("does not dim a selected card even when the lens excludes it", () => {
    renderCard({ dim: true, selected: true });
    expect(screen.getByTestId("node-card").className).not.toContain("is-off-lens");
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

  it("does not end a new edit when the previous field's blur timer fires", () => {
    vi.useFakeTimers();
    try {
      const onEditEnd = vi.fn();
      const view = renderCard({ editing: "title", onEditEnd });
      const title = view.container.querySelector(".card-title-editor");
      if (!title) throw new Error("title editor not mounted");

      fireEvent.blur(title);
      view.rerender(
        <ReactFlowProvider>
          <NodeCard {...base} editing={null} onEditEnd={onEditEnd} />
        </ReactFlowProvider>,
      );
      vi.advanceTimersByTime(200);

      expect(onEditEnd).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("presents a tour instead of editing it, from anywhere on the card", () => {
    const onDoubleClickPresent = vi.fn(() => true);
    const onStartEditing = vi.fn();
    renderCard({ onDoubleClickPresent, onStartEditing });

    // A tour has nothing to edit by double-clicking: the gesture means "show me
    // this" (ADR-0064 §11), and the body must not swallow it as "edit".
    fireEvent.doubleClick(screen.getByTestId("card-body"));
    fireEvent.doubleClick(screen.getByTestId("node-card"));

    expect(onDoubleClickPresent).toHaveBeenCalledTimes(2);
    expect(onStartEditing).not.toHaveBeenCalled();
  });

  it("opens the body editor on one click, because that is the common gesture", () => {
    const onStartEditing = vi.fn();
    renderCard({ onStartEditing });

    fireEvent.click(screen.getByTestId("card-body"));

    expect(onStartEditing).toHaveBeenCalledWith("body");
  });

  it("leaves a tour's click alone, so an ordinary press cannot start a presentation", () => {
    const onStartEditing = vi.fn();
    const onDoubleClickPresent = vi.fn(() => true);
    renderCard({ presentable: true, onDoubleClickPresent, onStartEditing });

    fireEvent.click(screen.getByTestId("card-body"));

    expect(onStartEditing).not.toHaveBeenCalled();
    expect(onDoubleClickPresent).not.toHaveBeenCalled();
  });

  it("does not edit when the press was really the start of a drag", () => {
    const onStartEditing = vi.fn();
    renderCard({ onStartEditing });
    const body = screen.getByTestId("card-body");

    fireEvent.pointerDown(body, { clientX: 10, clientY: 10 });
    fireEvent.click(body, { clientX: 90, clientY: 10 });

    expect(onStartEditing).not.toHaveBeenCalled();
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
