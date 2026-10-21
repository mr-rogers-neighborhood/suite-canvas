import * as Y from "yjs";
import {
  createConnectorId,
  defaultConnectors,
  nextFreeAnchor,
  snapToAnchor,
} from "../connectors.js";
import {
  type Connector,
  type GraphEdge,
  type GraphNode,
  graphEdgeSchema,
  graphNodeSchema,
} from "../schema.js";

export type GraphSection = "nodes" | "edges";
export type GraphAction = "add" | "update" | "delete";
export type LayerAction = "forward" | "front" | "backward" | "back";

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

export interface CreateEdgeInput {
  source: string;
  target: string;
  sourceConnector?: string | undefined;
  targetConnector?: string | undefined;
  kind?: GraphEdge["kind"];
}

function toAction(action: unknown): GraphAction {
  return action === "add" || action === "delete" ? action : "update";
}

/**
 * Backfills fields added after a document was created, so older local/server
 * documents keep loading.
 */
export function normalizeNode(node: GraphNode): GraphNode {
  const legacy = node as Partial<GraphNode> & { z?: number; connectors?: Connector[] };
  return {
    ...node,
    z: typeof legacy.z === "number" ? legacy.z : 0,
    connectors:
      Array.isArray(legacy.connectors) && legacy.connectors.length > 0
        ? legacy.connectors
        : defaultConnectors(),
  };
}

function normalizeEdge(edge: GraphEdge): GraphEdge {
  const legacy = edge as GraphEdge & { bidirectional?: boolean; path?: GraphEdge["path"] };
  return {
    ...edge,
    bidirectional: typeof legacy.bidirectional === "boolean" ? legacy.bidirectional : false,
    path: legacy.path ?? "bezier",
  };
}

function sortByLayer(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

/**
 * Typed wrapper over a Y.Doc. The document is the single source of truth:
 * nodes, edges and per-node rich text live in the same doc, and every write is
 * validated against the Zod schemas before it reaches the CRDT.
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
    return Array.from(this.nodes.values(), normalizeNode);
  }

  listEdges(): GraphEdge[] {
    return Array.from(this.edges.values(), normalizeEdge);
  }

  getNode(id: string): GraphNode | undefined {
    const node = this.nodes.get(id);
    return node ? normalizeNode(node) : undefined;
  }

  getEdge(id: string): GraphEdge | undefined {
    const edge = this.edges.get(id);
    return edge ? normalizeEdge(edge) : undefined;
  }

  setNode(node: GraphNode): void {
    this.nodes.set(node.id, graphNodeSchema.parse(normalizeNode(node)));
  }

  setEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, graphEdgeSchema.parse(normalizeEdge(edge)));
  }

  addEdge(input: CreateEdgeInput): GraphEdge | null {
    if (input.source === input.target) return null;

    const now = Date.now();
    const edge: GraphEdge = {
      id: crypto.randomUUID(),
      source: input.source,
      target: input.target,
      kind: input.kind ?? "references",
      path: "bezier",
      bidirectional: false,
      createdAt: now,
      updatedAt: now,
      ...(input.sourceConnector ? { sourceConnector: input.sourceConnector } : {}),
      ...(input.targetConnector ? { targetConnector: input.targetConnector } : {}),
    };
    this.setEdge(edge);
    return edge;
  }

  removeEdge(id: string): void {
    this.edges.delete(id);
  }

  setEdgePath(id: string, path: GraphEdge["path"]): void {
    const edge = this.getEdge(id);
    if (!edge) return;
    this.setEdge({ ...edge, path, updatedAt: Date.now() });
  }

  /** Reattaches one end of a link to another node/connector. */
  reconnectEdge(
    id: string,
    end: "source" | "target",
    nodeId: string,
    connectorId: string | undefined,
  ): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    const next: GraphEdge = { ...edge, updatedAt: Date.now() };
    if (end === "source") {
      if (nodeId === edge.target) return;
      next.source = nodeId;
      if (connectorId) next.sourceConnector = connectorId;
      else delete next.sourceConnector;
    } else {
      if (nodeId === edge.source) return;
      next.target = nodeId;
      if (connectorId) next.targetConnector = connectorId;
      else delete next.targetConnector;
    }

    this.setEdge(next);
  }

  /** Swaps the endpoints (and their connectors) of an existing link. */
  reverseEdge(id: string): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    const next: GraphEdge = {
      ...edge,
      source: edge.target,
      target: edge.source,
      updatedAt: Date.now(),
    };

    if (edge.sourceConnector) next.targetConnector = edge.sourceConnector;
    else delete next.targetConnector;
    if (edge.targetConnector) next.sourceConnector = edge.targetConnector;
    else delete next.sourceConnector;

    this.setEdge(next);
  }

  setEdgeBidirectional(id: string, bidirectional: boolean): void {
    const edge = this.getEdge(id);
    if (!edge) return;
    this.setEdge({ ...edge, bidirectional, updatedAt: Date.now() });
  }

  updateNodePosition(id: string, position: { x: number; y: number }): void {
    const node = this.getNode(id);
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
      z: 0,
      connectors: defaultConnectors(),
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

  addConnector(nodeId: string, position?: { x: number; y: number }): Connector | null {
    const node = this.getNode(nodeId);
    if (!node) return null;

    const anchor = position ?? nextFreeAnchor(node.connectors);
    const connector: Connector = { id: createConnectorId(), ...anchor };
    this.setNode({
      ...node,
      connectors: [...node.connectors, connector],
      updatedAt: Date.now(),
    });
    return connector;
  }

  removeConnector(nodeId: string, connectorId: string): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    this.setNode({
      ...node,
      connectors: node.connectors.filter((connector) => connector.id !== connectorId),
      updatedAt: Date.now(),
    });
  }

  /**
   * Moves a connector. Positions are free-form; pass `snap: true` to force the
   * nearest corner/side midpoint (the UI magnetizes while dragging instead).
   */
  moveConnector(
    nodeId: string,
    connectorId: string,
    position: { x: number; y: number },
    options: { snap?: boolean } = {},
  ): void {
    const node = this.getNode(nodeId);
    if (!node) return;

    const next = options.snap ? snapToAnchor(position) : position;
    this.setNode({
      ...node,
      connectors: node.connectors.map((connector) =>
        connector.id === connectorId ? { ...connector, ...next } : connector,
      ),
      updatedAt: Date.now(),
    });
  }

  /** Reassigns stacking order (0 = furthest back) for every node. */
  moveNodeLayer(id: string, action: LayerAction): void {
    const order = sortByLayer(this.listNodes());
    const index = order.findIndex((node) => node.id === id);
    if (index < 0) return;

    const [node] = order.splice(index, 1);
    if (!node) return;

    const target =
      action === "front"
        ? order.length
        : action === "back"
          ? 0
          : action === "forward"
            ? Math.min(order.length, index + 1)
            : Math.max(0, index - 1);

    order.splice(target, 0, node);

    const now = Date.now();
    order.forEach((entry, position) => {
      if (entry.z === position) return;
      this.nodes.set(entry.id, { ...entry, z: position, updatedAt: now });
    });
  }

  observe(onChange: (change: GraphChange) => void): () => void {
    const handleNodes = (event: Y.YMapEvent<GraphNode>): void => {
      event.keysChanged.forEach((key) => {
        const action = toAction(event.changes.keys.get(key)?.action);
        onChange({ section: "nodes", action, key, value: this.getNode(key) ?? null });
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
