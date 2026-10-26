import type { LoroMap } from "loro-crdt";
import { createConnectorId, nextFreeAnchor, snapToAnchor } from "../connectors.js";
import { edgeEndpoints, edgeTouches, isSelfLink, type LinkEndpoint, linkKey } from "../links.js";
import { edgeFromMap, normalizeEdge } from "../records/entities.js";
import { isMap, writeSurfaceStyle } from "../records/values.js";
import {
  type Card,
  type Connector,
  type EdgeEndpointKind,
  type GraphEdge,
  graphEdgeSchema,
  type Section,
} from "../schema.js";
import type { SurfaceStyle } from "../style.js";
import {
  CONNECTORS_FIELD,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  STRUCT_ORIGIN,
} from "./constants.js";
import type { DocContext } from "./context.js";
import type { CreateEdgeInput } from "./model.js";

/**
 * Owns edges: the links between cards, sections and boards, their routes and styles,
 * reconnecting and reversing them, and the connectors a card's link points at.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function edgesMethods(ctx: DocContext) {
  return {
    cachedEdge(id: string): GraphEdge | undefined {
      const cached = ctx.edgeCache.get(id);
      if (cached) return cached;
      const value = ctx.edges.get(id);
      if (!isMap(value)) return undefined;
      const edge = edgeFromMap(id, value);
      ctx.edgeCache.set(id, edge);
      return edge;
    },

    listEdges(): GraphEdge[] {
      return ctx.edges
        .keys()
        .map((id) => ctx.api.edges.cachedEdge(id))
        .filter((edge): edge is GraphEdge => edge !== undefined);
    },

    mutateEdge(edgeId: string, mutate: (fields: LoroMap) => void): void {
      const fields = ctx.edges.get(edgeId);
      if (!isMap(fields)) return;
      mutate(fields);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}edge`);
    },

    listBoardEdges(boardId: string): GraphEdge[] {
      const placed = new Map(
        ctx.api.placements.listBoardCards(boardId).map((card) => [card.id, card]),
      );
      const sections = new Map(
        ctx.api.sections.listSections(boardId).map((section) => [section.id, section]),
      );
      const portals = ctx.api.edges.portalsByTargetBoard(placed);
      return ctx.api.edges.listEdges().filter(
        (edge) =>
          edge.boardId === boardId &&
          ctx.api.edges.endpointIsDrawn(edgeEndpoints(edge).source, edge.sourceConnector, {
            placed,
            sections,
            portals,
          }) &&
          ctx.api.edges.endpointIsDrawn(edgeEndpoints(edge).target, edge.targetConnector, {
            placed,
            sections,
            portals,
          }),
      );
    },

    /**
     * On this board, the first portal card per target board. A board endpoint has
     * no position of its own, so it is drawn between portal instances: no portal
     * on this board means no line, though the link survives in the document.
     */
    portalsByTargetBoard(placed: Map<string, Card>): Map<string, Card> {
      const portals = new Map<string, Card>();
      for (const card of placed.values()) {
        if (card.primaryTypeId !== PORTAL_TYPE_ID) continue;
        const target = card.properties[PORTAL_BOARD_FIELD_ID];
        if (typeof target !== "string" || target.length === 0) continue;
        if (!portals.has(target)) portals.set(target, card);
      }
      return portals;
    },

    endpointIsDrawn(
      endpoint: LinkEndpoint,
      connectorId: string | undefined,
      context: {
        placed: Map<string, Card>;
        sections: Map<string, Section>;
        portals: Map<string, Card>;
      },
    ): boolean {
      switch (endpoint.kind) {
        case "card": {
          const card = context.placed.get(endpoint.id);
          if (!card) return false;
          if (!connectorId) return true;
          return card.connectors.some((connector) => connector.id === connectorId);
        }
        case "section": {
          const section = context.sections.get(endpoint.id);
          if (!section) return false;
          if (!connectorId) return true;
          return (section.connectors ?? []).some((connector) => connector.id === connectorId);
        }
        case "board":
          return context.portals.has(endpoint.id);
        default:
          return false;
      }
    },

    getEdge(id: string): GraphEdge | undefined {
      return ctx.api.edges.cachedEdge(id);
    },

    setEdge(edge: GraphEdge): void {
      const parsed = graphEdgeSchema.parse(normalizeEdge(edge));
      ctx.api.edges.applyEdge(parsed);
      ctx.commit(`${STRUCT_ORIGIN}set-edge`);
    },

    applyEdge(edge: GraphEdge): void {
      const fields = ctx.edges.ensureMergeableMap(edge.id);
      fields.set("boardId", edge.boardId);
      fields.set("source", edge.source);
      fields.set("target", edge.target);
      if (edge.sourceKind) fields.set("sourceKind", edge.sourceKind);
      else fields.delete("sourceKind");
      if (edge.targetKind) fields.set("targetKind", edge.targetKind);
      else fields.delete("targetKind");
      fields.set("kind", edge.kind);
      fields.set("path", edge.path);
      fields.set("bidirectional", edge.bidirectional);
      fields.set("createdAt", edge.createdAt);
      fields.set("updatedAt", edge.updatedAt);
      if (edge.sourceConnector) fields.set("sourceConnector", edge.sourceConnector);
      else fields.delete("sourceConnector");
      if (edge.targetConnector) fields.set("targetConnector", edge.targetConnector);
      else fields.delete("targetConnector");
      if (edge.label) fields.set("label", edge.label);
      else fields.delete("label");
    },

    addEdge(input: CreateEdgeInput): GraphEdge | null {
      const sourceKind = input.sourceKind ?? "card";
      const targetKind = input.targetKind ?? "card";
      const source = { kind: sourceKind, id: input.source };
      const target = { kind: targetKind, id: input.target };
      if (
        isSelfLink(source, target, {
          source: input.sourceConnector,
          target: input.targetConnector,
        })
      ) {
        return null;
      }
      if (!ctx.api.edges.endpointExists(source) || !ctx.api.edges.endpointExists(target))
        return null;

      const now = Date.now();
      const edge: GraphEdge = graphEdgeSchema.parse({
        id: crypto.randomUUID(),
        boardId: input.boardId,
        source: input.source,
        target: input.target,
        sourceKind,
        targetKind,
        kind: input.kind ?? "references",
        path: "bezier",
        bidirectional: false,
        createdAt: now,
        updatedAt: now,
        ...(input.sourceConnector ? { sourceConnector: input.sourceConnector } : {}),
        ...(input.targetConnector ? { targetConnector: input.targetConnector } : {}),
      });
      if (ctx.api.edges.isDuplicateEdge(edge)) return null;
      ctx.api.edges.applyEdge(edge);
      ctx.commit(`${STRUCT_ORIGIN}add-edge`);
      return edge;
    },

    /** A link may only point at a thing that exists in this workspace. */
    endpointExists(endpoint: LinkEndpoint): boolean {
      switch (endpoint.kind) {
        case "card":
          return ctx.api.cards.getCard(endpoint.id) !== undefined;
        case "board":
          return ctx.boards.get(endpoint.id) !== undefined;
        case "section":
          return ctx.sections.get(endpoint.id) !== undefined;
        default:
          return false;
      }
    },

    /**
     * Two links between the same endpoints on the same connectors are the same
     * connection; drawing it twice is a no-op rather than a second record.
     */
    isDuplicateEdge(candidate: GraphEdge): boolean {
      const key = linkKey(candidate);
      return ctx.api.edges
        .listEdges()
        .some((edge) => edge.id !== candidate.id && linkKey(edge) === key);
    },

    /** Every link with this thing at either end, including links to containers. */
    listLinksTo(kind: EdgeEndpointKind, id: string): GraphEdge[] {
      const endpoint = { kind, id };
      return ctx.api.edges.listEdges().filter((edge) => edgeTouches(edge, endpoint));
    },

    setEdgeEndpointKind(id: string, end: "source" | "target", kind: EdgeEndpointKind): void {
      if (!ctx.api.edges.getEdge(id)) return;
      ctx.api.edges.mutateEdge(id, (fields) =>
        fields.set(end === "source" ? "sourceKind" : "targetKind", kind),
      );
    },

    removeEdge(id: string): void {
      ctx.edges.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}remove-edge`);
    },

    setEdgePath(id: string, path: GraphEdge["path"]): void {
      if (!ctx.api.edges.getEdge(id)) return;
      ctx.api.edges.mutateEdge(id, (fields) => fields.set("path", path));
    },

    /**
     * A link's route: the bends a reader drew and which side of the cards it paints
     * on (ADR-0052). Bends
     * are stored relative to the source anchor, so a moved card takes them along.
     */
    setEdgeRoute(
      id: string,
      route: {
        bends?: { x: number; y: number }[] | undefined;
        layer?: "below" | "above" | undefined;
      },
    ): void {
      const fields = ctx.edges.get(id);
      if (!isMap(fields)) return;
      const bends = (route.bends ?? []).slice(0, 24);
      if (bends.length > 0)
        fields.set(
          "bends",
          bends.map((bend) => ({ x: bend.x, y: bend.y })),
        );
      else fields.delete("bends");
      if (route.layer && route.layer !== "below") fields.set("layer", route.layer);
      else fields.delete("layer");
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}edge-route`);
    },

    /** Stroke paint for a link. */
    setEdgeStyle(id: string, style: SurfaceStyle | null): void {
      const fields = ctx.edges.get(id);
      if (!isMap(fields)) return;
      writeSurfaceStyle(fields, style);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}edge-style`);
    },

    reconnectEdge(
      id: string,
      end: "source" | "target",
      cardId: string,
      connectorId: string | undefined,
      kind: EdgeEndpointKind = "card",
    ): void {
      const edge = ctx.api.edges.getEdge(id);
      if (!edge) return;

      const ends = edgeEndpoints(edge);
      const next = { kind, id: cardId };
      const otherEnd = end === "source" ? ends.target : ends.source;
      // The connector at the other end is what decides whether this closes a loop
      // or collapses onto one dot.
      const otherConnector = end === "source" ? edge.targetConnector : edge.sourceConnector;
      if (isSelfLink(next, otherEnd, { source: connectorId, target: otherConnector })) return;
      if (!ctx.api.edges.endpointExists(next)) return;

      const fields = { id: cardId };
      if (end === "source") {
        const candidate = {
          ...edge,
          source: fields.id,
          sourceKind: kind,
          sourceConnector: connectorId,
        };
        if (ctx.api.edges.isDuplicateEdge(candidate)) return;
        ctx.api.edges.mutateEdge(id, (entry) => {
          entry.set("source", fields.id);
          entry.set("sourceKind", kind);
          if (connectorId) entry.set("sourceConnector", connectorId);
          else entry.delete("sourceConnector");
        });
      } else {
        const candidate = {
          ...edge,
          target: fields.id,
          targetKind: kind,
          targetConnector: connectorId,
        };
        if (ctx.api.edges.isDuplicateEdge(candidate)) return;
        ctx.api.edges.mutateEdge(id, (entry) => {
          entry.set("target", fields.id);
          entry.set("targetKind", kind);
          if (connectorId) entry.set("targetConnector", connectorId);
          else entry.delete("targetConnector");
        });
      }
    },

    reverseEdge(id: string): void {
      const edge = ctx.api.edges.getEdge(id);
      if (!edge) return;

      // Swapping ids alone would leave each id paired with the other end's kind,
      // so a card-to-section link reversed would claim a card id is a section.
      const ends = edgeEndpoints(edge);
      ctx.api.edges.mutateEdge(id, (fields) => {
        fields.set("source", edge.target);
        fields.set("target", edge.source);
        fields.set("sourceKind", ends.target.kind);
        fields.set("targetKind", ends.source.kind);
        if (edge.sourceConnector) fields.set("targetConnector", edge.sourceConnector);
        else fields.delete("targetConnector");
        if (edge.targetConnector) fields.set("sourceConnector", edge.targetConnector);
        else fields.delete("sourceConnector");
      });
    },

    /** Free-text description of a drawn link; empty clears it. */
    setEdgeLabel(id: string, label: string | null): void {
      const edge = ctx.api.edges.getEdge(id);
      if (!edge) return;
      const next = label?.trim() ?? "";
      if ((edge.label ?? "") === next) return;
      ctx.api.edges.mutateEdge(id, (fields) => {
        if (next.length > 0) fields.set("label", next);
        else fields.delete("label");
      });
    },

    /**
     * Places the label along its path. `null` restores the midpoint; the value is
     * clamped, so a drag that overshoots the ends still lands on the link.
     */
    setEdgeLabelOffset(id: string, offset: number | null): void {
      const edge = ctx.api.edges.getEdge(id);
      if (!edge) return;
      if (offset === null) {
        if (edge.labelOffset === undefined) return;
        ctx.api.edges.mutateEdge(id, (fields) => {
          if (fields.get("labelOffset") !== undefined) fields.delete("labelOffset");
        });
        return;
      }
      const clamped = Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0.5));
      if (edge.labelOffset !== undefined && Math.abs(edge.labelOffset - clamped) < 0.001) return;
      ctx.api.edges.mutateEdge(id, (fields) => fields.set("labelOffset", clamped));
    },

    setEdgeBidirectional(id: string, bidirectional: boolean): void {
      if (!ctx.api.edges.getEdge(id)) return;
      ctx.api.edges.mutateEdge(id, (fields) => fields.set("bidirectional", bidirectional));
    },

    addConnector(cardId: string, position?: { x: number; y: number }): Connector | null {
      const card = ctx.api.cards.getCard(cardId);
      if (!card) return null;

      const anchor = position ?? nextFreeAnchor(card.connectors);
      const connector: Connector = { id: createConnectorId(), ...anchor };
      const order = card.connectors.length;
      ctx.api.cards.mutateCard(cardId, (fields) => {
        const connectors = fields.ensureMergeableMap(CONNECTORS_FIELD);
        const connectorFields = connectors.ensureMergeableMap(connector.id);
        connectorFields.set("x", connector.x);
        connectorFields.set("y", connector.y);
        connectorFields.set("order", order);
      });
      return connector;
    },

    removeConnector(cardId: string, connectorId: string): void {
      if (!ctx.api.cards.getCard(cardId)) return;
      const attached = ctx.api.edges
        .listEdges()
        .filter(
          (edge) =>
            (edge.source === cardId && edge.sourceConnector === connectorId) ||
            (edge.target === cardId && edge.targetConnector === connectorId),
        );
      ctx.api.cards.mutateCard(
        cardId,
        (fields) => {
          const connectors = fields.get(CONNECTORS_FIELD);
          if (isMap(connectors)) connectors.delete(connectorId);
        },
        false,
      );
      for (const edge of attached) ctx.edges.delete(edge.id);
      ctx.commit(`${STRUCT_ORIGIN}remove-connector`);
    },

    moveConnector(
      cardId: string,
      connectorId: string,
      position: { x: number; y: number },
      options: { snap?: boolean } = {},
    ): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card) return;

      const next = options.snap ? snapToAnchor(position) : position;
      const fields = ctx.api.edges.connectorFields(cardId, connectorId);
      if (!fields) return;
      fields.set("x", next.x);
      fields.set("y", next.y);
      const cardFields = ctx.cards.get(cardId);
      if (isMap(cardFields)) cardFields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}move-connector`);
    },

    /** Links pointing at a deleted container go with it; a dangling id is not a link. */
    deleteLinksTo(endpoint: LinkEndpoint): void {
      for (const edge of ctx.api.edges.listLinksTo(endpoint.kind, endpoint.id)) {
        ctx.edges.delete(edge.id);
      }
    },

    connectorFields(cardId: string, connectorId: string): LoroMap | undefined {
      const cardFields = ctx.cards.get(cardId);
      if (!isMap(cardFields)) return undefined;
      const connectors = cardFields.get(CONNECTORS_FIELD);
      if (!isMap(connectors)) return undefined;
      const fields = connectors.get(connectorId);
      return isMap(fields) ? fields : undefined;
    },
  };
}
