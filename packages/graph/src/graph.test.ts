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
  z: 0,
  connectors: [],
  data: {},
};

const edge: GraphEdge = {
  id: "e1",
  source: "n1",
  target: "n2",
  kind: "references",
  bidirectional: false,
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
    expect(graph.getNode("n1")?.kind).toBe("note");
  });

  it("stores and reads edges", () => {
    const graph = new GraphDocument();
    graph.setNode(note);
    graph.setEdge(edge);
    expect(graph.getEdge("e1")?.kind).toBe("references");
  });

  it("creates a note with a content fragment", () => {
    const graph = new GraphDocument();
    const created = graph.createNote({ id: "n1", position: { x: 10, y: 20 } });
    expect(created.kind).toBe("note");
    expect(graph.getNode("n1")).toEqual(created);
    expect(graph.getContent("n1")).toBe(graph.getContent("n1"));
  });

  it("returns the same content fragment for repeated access", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    expect(graph.getContent("n1")).toBe(graph.getContent("n1"));
  });

  it("removes content when a node is removed", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    const fragment = graph.getContent("n1");
    graph.removeNode("n1");
    expect(graph.getNode("n1")).toBeUndefined();
    expect(graph.getContent("n1")).not.toBe(fragment);
  });

  it("cascades edge removal when a node is removed", () => {
    const graph = new GraphDocument();
    graph.setNode(note);
    graph.setNode({ ...note, id: "n2" });
    graph.setEdge(edge);
    graph.removeNode("n1");
    expect(graph.listEdges()).toHaveLength(0);
  });

  it("starts a note with four connectors at the side midpoints", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    const connectors = graph.getNode("n1")?.connectors ?? [];
    expect(connectors).toHaveLength(4);
    expect(new Set(connectors.map((connector) => `${connector.x}:${connector.y}`))).toEqual(
      new Set(["0:0.5", "0.5:0", "0.5:1", "1:0.5"]),
    );
  });

  it("adds a connector on a free anchor", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    const added = graph.addConnector("n1");
    expect(added).not.toBeNull();
    expect(graph.getNode("n1")?.connectors).toHaveLength(5);
    expect(added).toMatchObject({ x: 0, y: 0 });
  });

  it("removes a connector", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    const first = graph.getNode("n1")?.connectors[0];
    if (!first) throw new Error("expected connectors");
    graph.removeConnector("n1", first.id);
    expect(graph.getNode("n1")?.connectors).toHaveLength(3);
  });

  it("snaps a moved connector to the nearest anchor", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    const first = graph.getNode("n1")?.connectors[0];
    if (!first) throw new Error("expected connectors");

    graph.moveConnector("n1", first.id, { x: 0.94, y: 0.88 }, { snap: true });
    const moved = graph.getNode("n1")?.connectors.find((connector) => connector.id === first.id);
    expect(moved).toMatchObject({ x: 1, y: 1 });
  });

  it("keeps free connector positions when snapping is not requested", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "n1", position: { x: 0, y: 0 } });
    const first = graph.getNode("n1")?.connectors[0];
    if (!first) throw new Error("expected connectors");

    graph.moveConnector("n1", first.id, { x: 0.32, y: 0 });
    const moved = graph.getNode("n1")?.connectors.find((connector) => connector.id === first.id);
    expect(moved).toMatchObject({ x: 0.32, y: 0 });
  });

  it("reorders nodes by layer", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "a", position: { x: 0, y: 0 } });
    graph.createNote({ id: "b", position: { x: 10, y: 0 } });
    graph.createNote({ id: "c", position: { x: 20, y: 0 } });

    graph.moveNodeLayer("a", "front");
    expect(graph.getNode("a")?.z).toBe(2);

    graph.moveNodeLayer("a", "back");
    expect(graph.getNode("a")?.z).toBe(0);

    graph.moveNodeLayer("a", "forward");
    expect(graph.getNode("a")?.z).toBe(1);

    graph.moveNodeLayer("a", "backward");
    expect(graph.getNode("a")?.z).toBe(0);
  });

  it("backfills connectors and layer for legacy nodes", () => {
    const graph = new GraphDocument();
    const legacy = { ...note } as unknown as Record<string, unknown>;
    delete legacy.connectors;
    delete legacy.z;
    graph.doc.getMap("nodes").set("n1", legacy);

    const restored = graph.getNode("n1");
    expect(restored?.z).toBe(0);
    expect(restored?.connectors).toHaveLength(4);
  });

  it("connects two connectors with a directed link", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "a", position: { x: 0, y: 0 } });
    graph.createNote({ id: "b", position: { x: 300, y: 0 } });
    const [sourceConnector] = graph.getNode("a")?.connectors ?? [];
    const [targetConnector] = graph.getNode("b")?.connectors ?? [];

    const created = graph.addEdge({
      source: "a",
      target: "b",
      sourceConnector: sourceConnector?.id ?? "",
      targetConnector: targetConnector?.id ?? "",
    });

    expect(created?.bidirectional).toBe(false);
    expect(graph.listEdges()).toHaveLength(1);
    expect(graph.getEdge(created?.id ?? "")).toMatchObject({
      source: "a",
      target: "b",
      sourceConnector: sourceConnector?.id,
      targetConnector: targetConnector?.id,
    });
  });

  it("refuses to connect a node to itself", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "a", position: { x: 0, y: 0 } });
    expect(graph.addEdge({ source: "a", target: "a" })).toBeNull();
  });

  it("reverses a link, swapping endpoints and connectors", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "a", position: { x: 0, y: 0 } });
    graph.createNote({ id: "b", position: { x: 300, y: 0 } });
    const edge = graph.addEdge({
      source: "a",
      target: "b",
      sourceConnector: "ca",
      targetConnector: "cb",
    });
    if (!edge) throw new Error("expected edge");

    graph.reverseEdge(edge.id);

    expect(graph.getEdge(edge.id)).toMatchObject({
      source: "b",
      target: "a",
      sourceConnector: "cb",
      targetConnector: "ca",
    });
  });

  it("toggles bidirectional links", () => {
    const graph = new GraphDocument();
    graph.createNote({ id: "a", position: { x: 0, y: 0 } });
    graph.createNote({ id: "b", position: { x: 300, y: 0 } });
    const edge = graph.addEdge({ source: "a", target: "b" });
    if (!edge) throw new Error("expected edge");

    graph.setEdgeBidirectional(edge.id, true);
    expect(graph.getEdge(edge.id)?.bidirectional).toBe(true);
  });

  it("backfills bidirectional on legacy edges", () => {
    const graph = new GraphDocument();
    const legacy = { ...edge } as unknown as Record<string, unknown>;
    delete legacy.bidirectional;
    graph.doc.getMap("edges").set("e1", legacy);
    expect(graph.getEdge("e1")?.bidirectional).toBe(false);
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
