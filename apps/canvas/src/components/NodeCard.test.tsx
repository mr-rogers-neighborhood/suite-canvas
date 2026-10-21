import type { Card } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NodeCard } from "./NodeCard";

const doc = new Y.Doc();
const fragment = doc.getXmlFragment("test");

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
const titleFragment = doc.getXmlFragment("test-title");

describe("NodeCard", () => {
  it("renders a read-only note card", () => {
    render(
      <ReactFlowProvider>
        <NodeCard
          card={card}
          fragment={fragment}
          titleFragment={titleFragment}
          boardId="board-1"
          awareness={null}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("node-card")).toBeInTheDocument();
  });

  it("renders presence avatars for peers on the node", () => {
    render(
      <ReactFlowProvider>
        <NodeCard
          card={card}
          fragment={fragment}
          titleFragment={titleFragment}
          boardId="board-1"
          awareness={null}
          presence={[{ name: "Nova", color: "#f97316" }]}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByTestId("presence-avatar")).toBeInTheDocument();
  });
});
