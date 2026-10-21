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
