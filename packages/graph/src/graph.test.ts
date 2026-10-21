import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "./schema.js";
import { graphEdgeSchema, graphNodeSchema } from "./schema.js";
import { GraphDocument } from "./yjs/GraphDocument.js";

const now = Date.now();

const note: GraphNode = {
  id: "n1",
  kind: "note",
  position: { x: 0, y: 0 },
  createdAt: now,
  updatedAt: now,
  data: { text: "hello" },
};

const edge: GraphEdge = {
  id: "e1",
  source: "n1",
  target: "n2",
  kind: "references",
  createdAt: now,
  updatedAt: now,
};

describe("graph schema", () => {
  it("accepts a valid note node", () => {
    expect(graphNodeSchema.parse(note)).toEqual(note);
  });

  it("rejects an unknown node kind", () => {
    expect(() => graphNodeSchema.parse({ ...note, kind: "unknown" })).toThrow();
  });

  it("rejects an edge with an unknown relation kind", () => {
    expect(() => graphEdgeSchema.parse({ ...edge, kind: "unknown" })).toThrow();
  });
});

describe("GraphDocument", () => {
  it("stores and reads nodes", () => {
    const graph = new GraphDocument();
    graph.setNode(note);
    expect(graph.listNodes()).toHaveLength(1);
    const stored = graph.getNode("n1");
    expect(stored?.kind).toBe("note");
    if (stored?.kind === "note") {
      expect(stored.data.text).toBe("hello");
    }
  });

  it("stores and reads edges", () => {
    const graph = new GraphDocument();
    graph.setNode(note);
    graph.setEdge(edge);
    expect(graph.getEdge("e1")?.kind).toBe("references");
  });

  it("cascades edge removal when a node is removed", () => {
    const graph = new GraphDocument();
    graph.setNode(note);
    graph.setNode({ ...note, id: "n2", data: { text: "world" } });
    graph.setEdge(edge);
    graph.removeNode("n1");
    expect(graph.listEdges()).toHaveLength(0);
  });

  it("emits typed change events on mutation", () => {
    const graph = new GraphDocument();
    const changes: string[] = [];
    const unsubscribe = graph.observe((change) => {
      changes.push(`${change.section}:${change.action}:${change.key}`);
    });
    graph.setNode(note);
    unsubscribe();
    expect(changes).toContain("nodes:add:n1");
  });
});
