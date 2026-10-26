import type { GraphEdge } from "@suite/graph";
import { ViewportPortal } from "@xyflow/react";
import { useState } from "react";
import { useEdges } from "../../store/workspaceStore";
import { useIsolatedEdgeId } from "../routeIsolation";
import {
  asRouteMode,
  pairOffset,
  type RoutePoint,
  reversePartnerOf,
  routePath,
  routePoints,
  shiftRoute,
} from "./edgeRoute";
import type { LinkAnchor } from "./linkGeometry";

/**
 * The section link layer, in its own file so the route work (ADR-0052) can grow
 * it — bends, a layer of its own — without reopening the board.
 */

export interface SectionLink {
  edge: GraphEdge;
  anchors: { source: LinkAnchor; target: LinkAnchor };
  offLens: boolean;
}

/** A gentle horizontal curve between two anchors, in flow coordinates. */
export function sectionLinkPath(anchors: { source: LinkAnchor; target: LinkAnchor }): string {
  const { source, target } = anchors;
  const bend = Math.max(32, Math.min(160, Math.abs(target.x - source.x) / 2));
  const direction = target.x >= source.x ? 1 : -1;
  return `M ${source.x},${source.y} C ${source.x + bend * direction},${source.y} ${
    target.x - bend * direction
  },${target.y} ${target.x},${target.y}`;
}

/**
 * What a link draws. A stored route — bends, or the bow that separates a reverse
 * pair — resolves through the same `routePath` a card link uses, so a bent
 * section link and a bent card link are the same shape. A link with neither
 * keeps the fixed curve it has always had, byte for byte.
 */
export function linkRoutePath(link: SectionLink, edges: readonly GraphEdge[]): string {
  const { source, target } = link.anchors;
  const bends = link.edge.bends ?? [];
  const mode = asRouteMode(link.edge.path);
  const shift: RoutePoint | null = reversePartnerOf(link.edge, edges)
    ? pairOffset(link.edge.id, source, target)
    : null;

  if (bends.length === 0 && !shift) {
    // `avoid` cannot see the board's frames from this layer; the documented
    // fallback for a link the router declines is the plain curve.
    return mode === "avoid"
      ? routePath(
          [
            { x: source.x, y: source.y },
            { x: target.x, y: target.y },
          ],
          "bezier",
        )
      : sectionLinkPath(link.anchors);
  }

  const points = routePoints({ x: source.x, y: source.y }, { x: target.x, y: target.y }, bends);
  return routePath(shift ? shiftRoute(points, shift) : points, mode);
}

/**
 * Links with a section end: a section is not a React Flow node, so its lines are
 * drawn here in flow space, anchored by the same geometry the cards use.
 */
export function SectionLinkLayer({
  links,
  selectedEdgeIds,
  onSelectEdge,
  onEdgeContextMenu,
  onReconnect,
  toFlow,
}: {
  links: SectionLink[];
  selectedEdgeIds: ReadonlySet<string>;
  onSelectEdge: (edgeId: string, additive?: boolean) => void;
  onEdgeContextMenu: (event: React.MouseEvent, edgeId: string) => void;
  /** Released a dragged end somewhere: the canvas resolves it and writes. */
  onReconnect?: (edgeId: string, end: "source" | "target", point: LinkAnchor) => void;
  toFlow?: (client: { x: number; y: number }) => LinkAnchor;
}) {
  // The end being dragged, and where the pointer is. A card link gets React
  // Flow's own updaters because it is an edge; a link that touches a section is
  // drawn by this layer, so its handles have to be its own.
  const [drag, setDrag] = useState<{
    edgeId: string;
    end: "source" | "target";
    fixed: LinkAnchor;
    pointer: LinkAnchor;
  } | null>(null);
  const edges = useEdges();
  const isolatedEdgeId = useIsolatedEdgeId();

  if (links.length === 0) return null;

  // A card's link gets React Flow's own end handles (it is an edge); a link that
  // touches a section has none, so these stand in. They live in their own layer
  // because they have to paint above the cards to be grabbable at all — the same
  // momentary elevation a selected card link gets.
  const handleLinks = links.filter((link) => selectedEdgeIds.has(link.edge.id));

  const beginDrag = (event: React.PointerEvent, link: SectionLink, end: "source" | "target") => {
    if (!onReconnect || !toFlow) return;
    event.preventDefault();
    event.stopPropagation();
    const fixed = end === "source" ? link.anchors.target : link.anchors.source;
    const pointer = toFlow({ x: event.clientX, y: event.clientY });
    setDrag({ edgeId: link.edge.id, end, fixed, pointer });

    const move = (moveEvent: PointerEvent) => {
      setDrag((current) =>
        current
          ? { ...current, pointer: toFlow({ x: moveEvent.clientX, y: moveEvent.clientY }) }
          : current,
      );
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      setDrag(null);
      onReconnect(link.edge.id, end, toFlow({ x: upEvent.clientX, y: upEvent.clientY }));
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };

  return (
    <ViewportPortal>
      <svg
        className="section-link-layer"
        data-testid="section-link-layer"
        // Purely decorative: the links themselves are selectable through the hit
        // paths below, and the edge menu carries their accessible actions.
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <marker
            id="section-link-arrow"
            viewBox="0 0 18 18"
            markerWidth="12"
            markerHeight="12"
            refX="9"
            refY="9"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 18 9 L 0 18 z" className="section-link-arrow" />
          </marker>
        </defs>
        {links.map((link) => {
          const selected = selectedEdgeIds.has(link.edge.id);
          // The route, not the fixed curve: bends and the reverse-pair bow are
          // the same geometry the card edge renders (ADR-0052 §2).
          const path = linkRoutePath(link, edges);
          const dimmed =
            link.offLens || (isolatedEdgeId !== null && isolatedEdgeId !== link.edge.id);
          return (
            <g key={link.edge.id} data-edge-id={link.edge.id}>
              {/* A section is not a React Flow node, so this line needs its own
                  hit area and click handling to be selectable like any edge. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the hit path is the pointer affordance for an edge the edge menu already describes. */}
              <path
                className="section-link__hit"
                d={path}
                data-testid="section-link-hit"
                // React Flow's pane claims the press (it captures the pointer to
                // drag the camera), so a click that starts here never arrives as
                // a click on this path. Claiming the press first is what makes a
                // section link selectable at all.
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  // Shift (and the platform modifiers) add to the selection, so a
                  // link can be selected alongside cards and other links.
                  onSelectEdge(link.edge.id, event.shiftKey || event.metaKey || event.ctrlKey);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectEdge(link.edge.id);
                  onEdgeContextMenu(event, link.edge.id);
                }}
              />
              <path
                data-testid="section-link"
                data-edge-id={link.edge.id}
                className={`section-link${dimmed ? " is-off-lens" : ""}${
                  selected ? " is-selected" : ""
                }`}
                d={path}
                markerEnd="url(#section-link-arrow)"
              />
            </g>
          );
        })}
      </svg>
      {handleLinks.map((link) => (
        <svg
          key={link.edge.id}
          className="section-link-handles"
          data-testid="section-link-handles"
          aria-hidden="true"
          focusable="false"
        >
          {(["source", "target"] as const).map((end) => (
            <g key={end}>
              <circle
                className="section-link-endpoint-hit"
                data-testid={`section-link-end-${end}`}
                cx={link.anchors[end].x}
                cy={link.anchors[end].y}
                r={11}
                onPointerDown={(event) => beginDrag(event, link, end)}
              />
              <circle
                className="section-link-endpoint"
                cx={link.anchors[end].x}
                cy={link.anchors[end].y}
                r={5}
              />
            </g>
          ))}
          {drag && drag.edgeId === link.edge.id ? (
            <line
              className="section-link-preview"
              data-testid="section-link-end-drag"
              x1={drag.fixed.x}
              y1={drag.fixed.y}
              x2={drag.pointer.x}
              y2={drag.pointer.y}
            />
          ) : null}
        </svg>
      ))}
      {drag && !handleLinks.some((link) => link.edge.id === drag.edgeId) ? (
        <svg
          className="section-link-handles"
          data-testid="section-link-handles"
          aria-hidden="true"
          focusable="false"
        >
          <line
            className="section-link-preview"
            data-testid="section-link-end-drag"
            x1={drag.fixed.x}
            y1={drag.fixed.y}
            x2={drag.pointer.x}
            y2={drag.pointer.y}
          />
        </svg>
      ) : null}
    </ViewportPortal>
  );
}
