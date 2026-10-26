import type { Connector, EdgeEndpointKind, GraphEdge } from "@suite/graph";
import { edgeEndpoints, PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import { useMemo } from "react";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/interactions/multiSelect";
import { asRouteMode, type RouteMode, type RoutePoint } from "../canvas/links/edgeRoute";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/** One end of a link as the panel reads it: what it is, and which dot holds it. */
export interface LinkEndView {
  kind: EdgeEndpointKind;
  id: string;
  /** The entity's name: a card title, a section title, a board name. */
  title: string;
  glyph: string;
  /** The connector the link is attached to, when the end names one that exists. */
  connector: Connector | null;
  /** Which dot of the entity it is, 1-based, for "dot 2 of 4". */
  connectorIndex: number | null;
  connectorCount: number;
  /** Board the end lives on, so navigation can switch first. */
  boardId: string | null;
  /** A portal stands in for its board; this is the card that draws it here. */
  viaCardId: string | null;
}

/**
 * Everything the link panel paints. A link is not an entity — it is an edge — so
 * this model is about the two things it joins, the dots it uses, and the three
 * values the canvas stores on it (path, direction, description) plus the label's
 * position along the line.
 */
export interface LinkInspectorModel {
  edge: GraphEdge;
  source: LinkEndView;
  target: LinkEndView;
  bidirectional: boolean;
  path: GraphEdge["path"];
  /**
   * The same value as `path`, read as a route mode: `avoid` is a route mode the
   * document may not accept yet, and the panel has to name it either way.
   */
  mode: RouteMode;
  /** The stored route, relative to the source anchor (ADR-0052 §1). */
  bends: RoutePoint[];
  layer: "below" | "above";
  /** Board-space centre of each end, where a new bend is placed. */
  sourceCenter: RoutePoint | null;
  targetCenter: RoutePoint | null;
  description: string;
  /** Where the description sits along the line, 0..1; the default is the middle. */
  labelOffset: number;
  canEdit: boolean;
  /** Structural writes: connector moves and removals follow the trash capability. */
  canManageStructure: boolean;
}

const KIND_GLYPH = { card: "\u25a1", board: "\u25c9", section: "\u25ad" } as const;

/** True when the panel has something to show: exactly one selected link. */
export function useLinkInspectorModel(): LinkInspectorModel | null {
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageStructure = useUiStore((state) => state.canManageTrash);
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const edgeId = selectedEdgeIds.length === 1 ? selectedEdgeIds[0] : null;

  return useMemo(() => {
    if (!edgeId) return null;
    const edge = snapshot.edges.find((entry) => entry.id === edgeId);
    if (!edge) return null;

    const endView = (
      kind: EdgeEndpointKind,
      id: string,
      connectorId: string | undefined,
    ): LinkEndView => {
      const base = { kind, id };
      if (kind === "card") {
        const card = snapshot.cards.find((entry) => entry.id === id);
        const placement = snapshot.placements.find((entry) => entry.cardId === id);
        const connectors = card?.connectors ?? [];
        const index = connectors.findIndex((entry) => entry.id === connectorId);
        return {
          ...base,
          title: card ? workspace.displayTitle(id) || "Untitled" : "Missing card",
          glyph: KIND_GLYPH.card,
          connector: index >= 0 ? (connectors[index] ?? null) : null,
          connectorIndex: index >= 0 ? index : null,
          connectorCount: connectors.length,
          boardId: placement?.boardId ?? null,
          viaCardId: null,
        };
      }
      if (kind === "section") {
        const section = snapshot.sections.find((entry) => entry.id === id);
        const connectors = section?.connectors ?? [];
        const index = connectors.findIndex((entry) => entry.id === connectorId);
        return {
          ...base,
          title: section?.title || "Untitled section",
          glyph: KIND_GLYPH.section,
          connector: index >= 0 ? (connectors[index] ?? null) : null,
          connectorIndex: index >= 0 ? index : null,
          connectorCount: connectors.length,
          boardId: section?.boardId ?? null,
          viaCardId: null,
        };
      }
      // A board is drawn through the portal that opens it, so the dot belongs to
      // that portal card — which is also what the user pointed at.
      const board = snapshot.boards.find((entry) => entry.id === id);
      const portal = snapshot.placements
        .map((placement) => snapshot.cards.find((card) => card.id === placement.cardId))
        .find(
          (card) =>
            card !== undefined && !card.deletedAt && card.properties[PORTAL_BOARD_FIELD_ID] === id,
        );
      const connectors = portal?.connectors ?? [];
      const index = connectors.findIndex((entry) => entry.id === connectorId);
      const portalPlacement = portal
        ? snapshot.placements.find((entry) => entry.cardId === portal.id)
        : undefined;
      return {
        ...base,
        title: board?.name ?? "Missing board",
        glyph: KIND_GLYPH.board,
        connector: index >= 0 ? (connectors[index] ?? null) : null,
        connectorIndex: index >= 0 ? index : null,
        connectorCount: connectors.length,
        boardId: portalPlacement?.boardId ?? null,
        viaCardId: portal?.id ?? null,
      };
    };

    const ends = edgeEndpoints(edge);
    const source = endView(ends.source.kind, ends.source.id, edge.sourceConnector);
    const target = endView(ends.target.kind, ends.target.id, edge.targetConnector);

    /**
     * Where an end sits on this board, so a new bend can be dropped at the middle
     * of the line instead of at the origin. A board end is drawn through its
     * portal card, which is the rect the user actually sees.
     */
    const centreOf = (view: LinkEndView): RoutePoint | null => {
      const cardId = view.kind === "board" ? view.viaCardId : view.kind === "card" ? view.id : null;
      if (cardId) {
        const placement = snapshot.placements.find(
          (entry) => entry.boardId === edge.boardId && entry.cardId === cardId,
        );
        if (!placement) return null;
        return {
          x: placement.x + (placement.width ?? DEFAULT_CARD_WIDTH) / 2,
          y: placement.y + (placement.height ?? DEFAULT_CARD_HEIGHT) / 2,
        };
      }
      const section = snapshot.sections.find(
        (entry) => entry.boardId === edge.boardId && entry.id === view.id,
      );
      if (!section) return null;
      return { x: section.x + section.width / 2, y: section.y + section.height / 2 };
    };

    return {
      edge,
      source,
      target,
      bidirectional: edge.bidirectional,
      path: edge.path,
      mode: asRouteMode(edge.path),
      bends: (edge.bends ?? []).map((bend) => ({ x: bend.x, y: bend.y })),
      layer: edge.layer ?? "below",
      sourceCenter: centreOf(source),
      targetCenter: centreOf(target),
      description: edge.label ?? "",
      labelOffset: edge.labelOffset ?? 0.5,
      canEdit: canEditLayout,
      canManageStructure,
    };
  }, [edgeId, snapshot, workspace, canEditLayout, canManageStructure]);
}

/** "dot 2 of 4", or a plain "no dot" when the link attaches to the shape only. */
export function describeDot(end: LinkEndView): string {
  if (end.connectorIndex === null) return "attached to the shape, not a dot";
  return `dot ${end.connectorIndex + 1} of ${end.connectorCount}`;
}
