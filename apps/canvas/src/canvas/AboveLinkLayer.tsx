import { resolveSurfaceStyle } from "@suite/graph";
import { ViewportPortal } from "@xyflow/react";
import { useEdges } from "../store/workspaceStore";
import { useIsolatedEdgeId } from "./routeIsolation";
import { linkRoutePath, type SectionLink } from "./SectionLinkLayer";
import { linkStroke } from "./surfacePaint";

export interface AboveLinkLayerProps {
  /** Every link that asked to paint above the cards (`layer: "above"`). */
  links: readonly SectionLink[];
  selectedEdgeIds: ReadonlySet<string>;
  onSelectEdge: (edgeId: string, additive?: boolean) => void;
  onEdgeContextMenu: (event: React.MouseEvent, edgeId: string) => void;
}

/**
 * The links that paint **above** the cards.
 *
 * React Flow draws every edge in one SVG beneath the nodes (ADR-0048), so an edge
 * that opts into `layer: "above"` cannot be raised per element: it has to be
 * drawn in its own layer. This is that layer — same flow-space geometry as a
 * section link, same hit behaviour, one z-index step above the cards.
 *
 * The route work (ADR-0052) grows this file: bends, the avoid mode and the
 * reverse-pair offset all resolve through the same `linkAnchors` this receives.
 */
export function AboveLinkLayer({
  links,
  selectedEdgeIds,
  onSelectEdge,
  onEdgeContextMenu,
}: AboveLinkLayerProps) {
  const edges = useEdges();
  const isolatedEdgeId = useIsolatedEdgeId();
  if (links.length === 0) return null;

  return (
    <ViewportPortal>
      <svg
        className="above-link-layer"
        data-testid="above-link-layer"
        // Decorative: the links are selectable through the hit paths below, and the
        // edge menu already describes them.
        aria-hidden="true"
        focusable="false"
      >
        {links.map((link) => {
          const selected = selectedEdgeIds.has(link.edge.id);
          // Same route as the edge component and the section layer (ADR-0052 §2):
          // bends and the reverse-pair bow are shared geometry, not per layer.
          const path = linkRoutePath(link, edges);
          // Isolate (ADR-0052 §7) recedes everything but the chosen link.
          const dimmed = isolatedEdgeId !== null && isolatedEdgeId !== link.edge.id;
          // The same paint the edge layer gives a link below the cards, so raising
          // one never changes how it looks (ADR-0051 §1).
          const paint = linkStroke(resolveSurfaceStyle(link.edge.style, "link"));
          return (
            <g
              key={link.edge.id}
              className={`above-link-group${selected ? " is-selected" : ""}${
                dimmed ? " is-dimmed" : ""
              }`}
            >
              {/* The visible stroke never takes a press; the wide stroke below is
                  the hit target, so a click lands on the line wherever it is. */}
              <path
                className="above-link"
                data-testid="above-link"
                data-edge-id={link.edge.id}
                data-selected={selected ? "true" : undefined}
                d={path}
                style={paint}
                markerEnd="url(#section-link-arrow)"
              />
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the hit path is the pointer affordance for an edge the edge menu already describes. */}
              <path
                className="above-link__hit"
                data-testid="above-link-hit"
                d={path}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  onSelectEdge(link.edge.id, event.shiftKey || event.metaKey || event.ctrlKey);
                }}
                onContextMenu={(event) => onEdgeContextMenu(event, link.edge.id)}
              />
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
