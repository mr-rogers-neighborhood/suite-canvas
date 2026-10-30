import type { Card, EdgeEndpointKind, GraphEdge, Placement } from "@suite/graph";
import { edgeEndpoints, sectionMembership } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { type CardMeta, cardMeta } from "../../cards/cardMeta";
import { resolveCardType, typesById } from "../../cards/cardTypes";
import { portalTargetId } from "../../cards/portal";
import { type LinkScene, linkAnchors } from "../links/linkGeometry";
import type { SectionLink } from "../links/SectionLinkLayer";
import { paintSurface } from "../surfaceContext";
import type { useBoardUi } from "./useBoardUi";

/** A link React Flow draws between two of this board's nodes. */
export interface FlowLink {
  edge: GraphEdge;
  source: string;
  target: string;
  offLens: boolean;
}

/**
 * Board-scoped views of the snapshot: what is on this board, where a link can
 * anchor, and which links are drawable here. Pure derivations — nothing here
 * writes to the document.
 */
export function useBoardProjection(ui: ReturnType<typeof useBoardUi>) {
  const { snapshot, activeBoardId, lens, surfacePaint, readerRadius } = ui;
  const typeMap = useMemo(() => typesById(snapshot.types), [snapshot.types]);

  const boardPlacements = useMemo(() => {
    const map = new Map<string, Placement>();
    if (!activeBoardId) return map;
    for (const placement of snapshot.placements) {
      if (placement.boardId === activeBoardId) map.set(placement.cardId, placement);
    }
    return map;
  }, [snapshot, activeBoardId]);

  const cardsById = useMemo(
    () => new Map(snapshot.cards.map((card) => [card.id, card])),
    [snapshot],
  );

  const boardCards: Card[] = useMemo(() => {
    if (!activeBoardId) return [];
    return [...boardPlacements.values()]
      .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId))
      .flatMap((placement) => {
        const card = cardsById.get(placement.cardId);
        return card && !card.deletedAt ? [card] : [];
      });
  }, [boardPlacements, cardsById, activeBoardId]);

  const boardEdges: GraphEdge[] = useMemo(() => {
    if (!activeBoardId) return [];
    // Which links are drawable is decided when they are projected (an endpoint
    // may be a section or a board, not just a card); the document keeps links
    // whose ends are simply not on this board.
    return snapshot.edges.filter((edge) => edge.boardId === activeBoardId);
  }, [snapshot.edges, activeBoardId]);

  const boardPlacementList = useMemo(() => [...boardPlacements.values()], [boardPlacements]);

  /** Board cards in paint order (bottom to top), the order layer actions apply in. */
  const boardOrder = useMemo(() => boardCards.map((card) => card.id), [boardCards]);

  const boardSections = useMemo(() => {
    if (!activeBoardId) return [];
    return snapshot.sections.filter((section) => section.boardId === activeBoardId);
  }, [snapshot.sections, activeBoardId]);

  /** The first portal on this board per target board, in paint order. */
  const portalByTargetBoard = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of boardCards) {
      const target = portalTargetId(card);
      if (target && !map.has(target)) map.set(target, card.id);
    }
    return map;
  }, [boardCards]);

  /** Placements of live cards only, so a trashed card cannot anchor a line. */
  const linkPlacements = useMemo(
    () =>
      boardCards.flatMap((card) => {
        const placement = boardPlacements.get(card.id);
        return placement ? [placement] : [];
      }),
    [boardCards, boardPlacements],
  );

  /**
   * The radius a card paints, in pixels: the ladder `rules.ts` owns (paint, then rule,
   * then reader preference, then the 12px default), read through the same call the card
   * face makes. A link anchor needs the number because the dot it belongs to is drawn on
   * the *painted* edge, not on the box.
   */
  const cardRadiusPx = useCallback(
    (card: Pick<Card, "style" | "primaryTypeId">) => {
      const type = resolveCardType(typeMap, card.primaryTypeId);
      const paint = paintSurface(card.style, type?.style, { surface: "card" }, surfacePaint).paint;
      const declared = Number.parseFloat(paint["--paint-radius"] ?? "");
      if (Number.isFinite(declared)) return declared;
      return readerRadius;
    },
    [surfacePaint, typeMap, readerRadius],
  );

  /**
   * Everything a link endpoint resolves against, in flow coordinates. A board
   * endpoint has no position of its own: it is drawn through the portal that
   * opens it, which is why the portals travel with the scene.
   */
  const linkScene = useMemo<LinkScene>(
    () => ({
      placements: linkPlacements,
      sections: boardSections,
      cards: snapshot.cards.map((card) => ({
        id: card.id,
        connectors: card.connectors,
        // The radius the card paints, so an anchor lands on the arc its dot is drawn on.
        // Resolved by `paintSurface`, the same call the card face makes, so this is the
        // one ladder rather than a second reading of it.
        radius: cardRadiusPx(card),
      })),
      portals: activeBoardId
        ? [...portalByTargetBoard].map(([targetBoardId, cardId]) => ({
            boardId: activeBoardId,
            cardId,
            targetBoardId,
          }))
        : [],
    }),
    [
      linkPlacements,
      boardSections,
      snapshot.cards,
      portalByTargetBoard,
      activeBoardId,
      cardRadiusPx,
    ],
  );

  /**
   * The React Flow node an endpoint is drawn through: a card is its own node, a
   * board is the portal standing in for it, and a section has no node at all.
   */
  const nodeIdForEndpoint = useCallback(
    (endpoint: { kind: EdgeEndpointKind; id: string }): string | null => {
      if (endpoint.kind === "card") return endpoint.id;
      if (endpoint.kind === "board") return portalByTargetBoard.get(endpoint.id) ?? null;
      return null;
    },
    [portalByTargetBoard],
  );

  /**
   * Every link on this board, resolved: cards and portals become React Flow
   * edges, anything touching a section becomes a flow-space line. A link whose
   * ends are not both here is simply not drawn — it stays in the document.
   */
  const projectedLinks = useMemo(() => {
    const flow: FlowLink[] = [];
    const sections: SectionLink[] = [];
    // A link may ask to paint over the cards. React Flow has one edge layer, so
    // those are drawn separately rather than raised per element (ADR-0052 §3).
    const above: SectionLink[] = [];
    if (!activeBoardId) return { flow, sections, above };

    const onLens = (endpoint: { kind: EdgeEndpointKind; id: string }) =>
      endpoint.kind !== "card" || lens.cardIds.has(endpoint.id);

    for (const edge of boardEdges) {
      const ends = edgeEndpoints(edge);
      // The edge's own dots travel with the endpoints: without them a link that
      // touches a section (or any end without a React Flow handle) is drawn from
      // the facing side rather than from the connector it was attached to.
      const endpoints = {
        source: { ...ends.source, connectorId: edge.sourceConnector },
        target: { ...ends.target, connectorId: edge.targetConnector },
      };
      const anchors = linkAnchors(endpoints, activeBoardId, linkScene);
      if (!anchors) continue;
      const offLens = lens.view !== null && !(onLens(endpoints.source) && onLens(endpoints.target));
      const source = nodeIdForEndpoint(endpoints.source);
      const target = nodeIdForEndpoint(endpoints.target);
      if (edge.layer === "above") above.push({ edge, anchors, offLens });
      if (source && target) flow.push({ edge, source, target, offLens });
      else sections.push({ edge, anchors, offLens });
    }
    return { flow, sections, above };
  }, [boardEdges, activeBoardId, linkScene, nodeIdForEndpoint, lens]);

  const sectionMembershipMap = useMemo(
    () => sectionMembership(boardPlacementList, boardSections),
    [boardPlacementList, boardSections],
  );

  const tagMap = useMemo(() => new Map(snapshot.tags.map((tag) => [tag.id, tag])), [snapshot.tags]);
  const metaByCard = useMemo(() => {
    const map = new Map<string, CardMeta>();
    for (const card of boardCards) map.set(card.id, cardMeta(card, typeMap, tagMap));
    return map;
  }, [boardCards, typeMap, tagMap]);

  return {
    boardPlacements,
    cardsById,
    boardCards,
    boardEdges,
    boardPlacementList,
    boardOrder,
    boardSections,
    portalByTargetBoard,
    linkPlacements,
    cardRadiusPx,
    linkScene,
    nodeIdForEndpoint,
    projectedLinks,
    sectionMembershipMap,
    typeMap,
    tagMap,
    metaByCard,
  };
}
