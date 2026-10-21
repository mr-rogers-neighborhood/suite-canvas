import type { GraphNode } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NodeCard } from "./NodeCard";

const doc = new Y.Doc();
const fragment = doc.getXmlFragment("test");

const node: GraphNode = {
  id: "n1",
  kind: "note",
  position: { x: 0, y: 0 },
  createdAt: 0,
  updatedAt: 0,
  data: {},
};

describe("NodeCard", () => {
  it("renders a read-only note card", () => {
    render(<NodeCard node={node} fragment={fragment} awareness={null} />);
    expect(screen.getByTestId("node-card")).toBeInTheDocument();
  });

  it("renders presence avatars for peers on the node", () => {
    render(
      <NodeCard
        node={node}
        fragment={fragment}
        awareness={null}
        presence={[{ name: "Nova", color: "#f97316" }]}
      />,
    );
    expect(screen.getByTestId("presence-avatar")).toBeInTheDocument();
  });
});
