import * as Y from "yjs";
import { type GraphEdge, type GraphNode, graphEdgeSchema, graphNodeSchema } from "../schema.js";

export type GraphSection = "nodes" | "edges";
export type GraphAction = "add" | "update" | "delete";

export interface GraphChange {
  section: GraphSection;
  action: GraphAction;
  key: string;
  value: GraphNode | GraphEdge | null;
}

export interface CreateNoteInput {
  id: string;
  position: { x: number; y: number };
}

function toAction(action: unknown): GraphAction {
  return action === "add" || action === "delete" ? action : "update";
}

/**
 * Typed wrapper over a Y.Doc. The document is the single source of truth:
 * nodes and edges live in two Y.Maps, and every write is validated against
 * the Zod schemas before it reaches the CRDT.
 */
export class GraphDocument {
  static readonly NODES_KEY = "nodes";
  static readonly EDGES_KEY = "edges";
  static readonly CONTENT_KEY = "content";

  readonly doc: Y.Doc;
  private readonly nodes: Y.Map<GraphNode>;
  private readonly edges: Y.Map<GraphEdge>;
  private readonly content: Y.Map<Y.XmlFragment>;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.nodes = doc.getMap<GraphNode>(GraphDocument.NODES_KEY);
    this.edges = doc.getMap<GraphEdge>(GraphDocument.EDGES_KEY);
    this.content = doc.getMap<Y.XmlFragment>(GraphDocument.CONTENT_KEY);
  }

  listNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  listEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  setNode(node: GraphNode): void {
    this.nodes.set(node.id, graphNodeSchema.parse(node));
  }

  setEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, graphEdgeSchema.parse(edge));
  }

  updateNodePosition(id: string, position: { x: number; y: number }): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.setNode({ ...node, position, updatedAt: Date.now() });
  }

  getContent(nodeId: string): Y.XmlFragment {
    const existing = this.content.get(nodeId);
    if (existing) return existing;
    const fragment = new Y.XmlFragment();
    this.content.set(nodeId, fragment);
    return fragment;
  }

  removeContent(nodeId: string): void {
    this.content.delete(nodeId);
  }

  createNote(input: CreateNoteInput): GraphNode {
    const now = Date.now();
    const node: GraphNode = {
      id: input.id,
      kind: "note",
      position: input.position,
      createdAt: now,
      updatedAt: now,
      data: {},
    };
    this.setNode(node);
    this.getContent(node.id);
    return node;
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) {
        this.edges.delete(edgeId);
      }
    }
    this.removeContent(id);
  }

  removeEdge(id: string): void {
    this.edges.delete(id);
  }

  observe(onChange: (change: GraphChange) => void): () => void {
    const handleNodes = (event: Y.YMapEvent<GraphNode>): void => {
      event.keysChanged.forEach((key) => {
        const action = toAction(event.changes.keys.get(key)?.action);
        onChange({ section: "nodes", action, key, value: this.nodes.get(key) ?? null });
      });
    };

    const handleEdges = (event: Y.YMapEvent<GraphEdge>): void => {
      event.keysChanged.forEach((key) => {
        const action = toAction(event.changes.keys.get(key)?.action);
        onChange({ section: "edges", action, key, value: this.edges.get(key) ?? null });
      });
    };

    this.nodes.observe(handleNodes);
    this.edges.observe(handleEdges);

    return () => {
      this.nodes.unobserve(handleNodes);
      this.edges.unobserve(handleEdges);
    };
  }
}
