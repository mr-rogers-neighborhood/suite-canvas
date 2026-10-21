import type { Card } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { NodeCard } from "./NodeCard";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("n1").id;

const card: Card = {
  id: "n1",
  kind: "note",
  createdAt: 0,
  updatedAt: 0,
  connectors: [
    { id: "c-top", x: 0.5, y: 0 },
    { id: "c-right", x: 1, y: 0.5 },
    { id: "c-bottom", x: 0.5, y: 1 },
    { id: "c-left", x: 0, y: 0.5 },
  ],
  data: {},
};

const base = {
  card,
  cardDoc: doc,
  contentId,
  titleId,
  cursorStore: null,
  localUser: null,
  boardId: "board-1",
};

describe("NodeCard", () => {
  it("renders a read-only note card", () => {
    render(
      <ReactFlowProvider>
        <NodeCard {...base} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("node-card")).toBeInTheDocument();
  });

  it("renders presence avatars for peers on the node", () => {
    render(
      <ReactFlowProvider>
        <NodeCard {...base} presence={[{ name: "Nova", color: "#f97316" }]} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("presence-avatar")).toBeInTheDocument();
  });
});
