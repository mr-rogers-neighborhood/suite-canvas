import type { GraphEdge } from "@suite/graph";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { PeerNameTag } from "../presence/PeerNameTag";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./interactions/multiSelect";
import {
  absoluteBends,
  asRouteMode,
  avoidRoute,
  isAvoidMode,
  type LoopRect,
  pairOffset,
  type RouteMode,
  type RoutePoint,
  type RouteRect,
  reversePartnerOf,
  routePath,
  routePoints,
  selfLoopRoute,
  shiftRoute,
} from "./links/edgeRoute";
import { useIsolatedEdgeId } from "./routeIsolation";

/** Routing and label placement carried in `data`, so one component renders every style. */
export interface EdgeDescriptionData {
  path: GraphEdge["path"];
  /** Where the label sits along the path, 0..1. */
  labelOffset?: number | undefined;
  /** Reports a label being slid: `start`/`move` while dragging, `stop` to persist. */
  onLabelDrag?:
    | ((edgeId: string, offset: number, phase: "start" | "move" | "stop") => void)
    | undefined;
  /** Double-clicking the label opens the same editor as double-clicking the line. */
  onLabelEdit?: ((edgeId: string, point: { x: number; y: number }) => void) | undefined;
}

/** Points sampled when projecting a pointer onto the path. */
const SAMPLES = 48;

/** The document's own cap (`bends` is `max(24)` in the schema). */
const MAX_BENDS = 24;

const NO_BENDS: readonly RoutePoint[] = [];

function pathOf(data: unknown): RouteMode {
  return asRouteMode((data as Partial<EdgeDescriptionData> | undefined)?.path);
}

function labelOffsetOf(data: unknown): number {
  const offset = (data as Partial<EdgeDescriptionData> | undefined)?.labelOffset;
  return typeof offset === "number" && Number.isFinite(offset) ? clamp(offset) : 0.5;
}

function clamp(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

/** One decimal is enough for a flow-unit coordinate and keeps the document tidy. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The edge's own record, straight from the snapshot rather than through React
 * Flow's `data`: bends and layer are document facts and have to survive the
 * board rebuilding its edge list.
 */
function useEdgeRecord(edgeId: string): GraphEdge | undefined {
  const store = useWorkspaceStore();
  const get = useCallback(
    () => store.getSnapshot().edges.find((entry) => entry.id === edgeId),
    [store, edgeId],
  );
  return useSyncExternalStore(store.subscribe, get, get);
}

/** Every edge on the board, for the reverse-pair rule (ADR-0052 §5). */
function useAllEdges(): readonly GraphEdge[] {
  const store = useWorkspaceStore();
  const get = useCallback(() => store.getSnapshot().edges, [store]);
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * The card and section frames of this board, which `avoid` routes around. Read
 * from the snapshot, so the obstacles are document data: every client routes the
 * same line around the same cards.
 */
function useObstacleRects(): readonly RouteRect[] {
  const store = useWorkspaceStore();
  const placementsOf = useCallback(() => store.getSnapshot().placements, [store]);
  const sectionsOf = useCallback(() => store.getSnapshot().sections, [store]);
  const placements = useSyncExternalStore(store.subscribe, placementsOf, placementsOf);
  const sections = useSyncExternalStore(store.subscribe, sectionsOf, sectionsOf);
  return useMemo<RouteRect[]>(
    () => [
      ...placements.map((placement) => ({
        x: placement.x,
        y: placement.y,
        width: placement.width ?? DEFAULT_CARD_WIDTH,
        height: placement.height ?? DEFAULT_CARD_HEIGHT,
      })),
      ...sections.map((section) => ({
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
      })),
    ],
    [placements, sections],
  );
}

interface RouteDraw {
  path: string;
  /** Where the label falls back to when the path cannot be measured. */
  mid: RoutePoint;
  /** The drawn bend positions, for the drag handles. */
  bends: RoutePoint[];
}

/**
 * The one place a card link's geometry is decided. With no bends, no reverse
 * partner and no `avoid`, it returns exactly what the React Flow helper would —
 * every link that existed before ADR-0052 draws byte for byte as it did.
 */
function drawRoute(input: {
  id: string;
  source: RoutePoint;
  target: RoutePoint;
  sourcePosition: EdgeProps["sourcePosition"];
  targetPosition: EdgeProps["targetPosition"];
  mode: RouteMode;
  bends: readonly RoutePoint[];
  /** The perpendicular nudge that separates a reverse pair, or null. */
  shift: RoutePoint | null;
  obstacles: readonly RouteRect[];
  /** The card's box when both ends are on the same card, so the loop can go around it. */
  selfLoopRect: LoopRect | null;
}): RouteDraw {
  const { source, target, sourcePosition, targetPosition, mode, bends, shift, obstacles } = input;

  // A card linked to itself is a route through a card, and a route through a card has
  // to leave it: bows around the edge instead of cutting across the face.
  if (input.selfLoopRect) {
    const loop = selfLoopRoute(source, target, input.selfLoopRect);
    if (loop) {
      const box = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
      return { path: routePath(loop, mode), mid: box, bends: [] };
    }
  }
  const helpers = {
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition,
    targetX: target.x,
    targetY: target.y,
    targetPosition,
  };
  const box = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };

  const points = routePoints(source, target, bends);
  const drawn = shift ? shiftRoute(points, shift) : points;
  const handles = absoluteBends(source, bends).map((bend) => ({
    x: bend.x + (shift?.x ?? 0),
    y: bend.y + (shift?.y ?? 0),
  }));

  // Bends win over `avoid`: a hand-drawn route is never silently re-routed.
  if (handles.length > 0) return { path: routePath(drawn, mode), mid: box, bends: handles };

  if (isAvoidMode(mode)) {
    // Memoized on the anchor pair rather than per frame: a resting link routes
    // once, and a card being dragged asks again each frame — bounded by the
    // router's own node budget, and never more than one search per render.
    const routed = avoidRoute(source, target, obstacles);
    // `null` is the documented fallback: draw the plain bezier. A paired link
    // keeps its bow, so the two directions of a pair still cannot overlap.
    if (routed)
      return {
        path: routePath(shift ? shiftRoute(routed, shift) : routed, "avoid"),
        mid: box,
        bends: [],
      };
    return { path: getBezierPath(helpers)[0], mid: box, bends: [] };
  }

  if (shift) return { path: routePath(drawn, mode), mid: box, bends: [] };

  switch (mode) {
    case "straight":
      return { path: getStraightPath(helpers)[0], mid: box, bends: [] };
    case "step":
      return { path: getSmoothStepPath({ ...helpers, borderRadius: 0 })[0], mid: box, bends: [] };
    case "smoothstep":
      return { path: getSmoothStepPath(helpers)[0], mid: box, bends: [] };
    default:
      return { path: getBezierPath(helpers)[0], mid: box, bends: [] };
  }
}

/** One reusable element: `getPointAtLength` is the only curve maths needed here. */
let ruler: SVGPathElement | null = null;

function rulerFor(path: string): SVGPathElement | null {
  if (typeof document === "undefined") return null;
  ruler ??= document.createElementNS("http://www.w3.org/2000/svg", "path");
  ruler.setAttribute("d", path);
  return typeof ruler.getTotalLength === "function" ? ruler : null;
}

/** The point a fraction of the way along an SVG path, or null without geometry support. */
export function pointOnPath(path: string, fraction: number): { x: number; y: number } | null {
  const element = rulerFor(path);
  if (!element) return null;
  const total = element.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return null;
  const point = element.getPointAtLength(total * clamp(fraction));
  return { x: point.x, y: point.y };
}

/**
 * The fraction of the path closest to a point, so a dragged label slides along
 * the link instead of floating free of it. Sampled, then refined around the
 * best sample — enough precision for a chip a few pixels tall.
 */
export function nearestFractionOnPath(
  path: string,
  point: { x: number; y: number },
): number | null {
  const element = rulerFor(path);
  if (!element) return null;
  const total = element.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return null;

  const distanceAt = (fraction: number) => {
    const at = element.getPointAtLength(total * clamp(fraction));
    return Math.hypot(at.x - point.x, at.y - point.y);
  };

  let best = 0.5;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= SAMPLES; index += 1) {
    const fraction = index / SAMPLES;
    const distance = distanceAt(fraction);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = fraction;
    }
  }

  let step = 1 / SAMPLES;
  for (let pass = 0; pass < 6; pass += 1) {
    step /= 2;
    for (const candidate of [best - step, best + step]) {
      const fraction = clamp(candidate);
      const distance = distanceAt(fraction);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = fraction;
      }
    }
  }
  return best;
}

/** The peer currently sliding this edge's label, as one stable string. */
function useLabelDragger(edgeId: string): { name: string; color: string; offset: number } | null {
  const mark = usePresenceStore((state) => {
    for (const peer of Object.values(state.peers)) {
      const drag = peer.labelDrag;
      if (drag?.edgeId === edgeId) {
        return `${peer.clientId}\u0000${peer.user.color}\u0000${peer.user.name}\u0000${drag.offset}`;
      }
    }
    return "";
  });
  if (!mark) return null;
  const [, color = "", name = "", offset = "0.5"] = mark.split("\u0000");
  return { name, color, offset: Number(offset) };
}

/**
 * Renders a canvas link: the default path styles plus the description as an
 * HTML chip that floats just above the line wherever it is placed. The chip is
 * counter-scaled so it stays legible at any zoom, and can be slid along the
 * path — peers see it move in the dragger's colour.
 */
export function EdgeWithDescription({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
  data,
  selected,
}: EdgeProps) {
  const zoom = useStore((state) => state.transform[2]);
  const { screenToFlowPosition } = useReactFlow();
  const workspace = useCanvasStore((state) => state.workspace);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const dragger = useLabelDragger(id);
  const edge = useEdgeRecord(id);
  const edges = useAllEdges();
  const obstacles = useObstacleRects();
  const isolatedEdgeId = useIsolatedEdgeId();
  const [live, setLive] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const latest = useRef<number | null>(null);
  // The bend under the pointer, if one is being dragged. Live only: the document
  // sees one write, on release.
  const [liveBend, setLiveBend] = useState<{ index: number; point: RoutePoint } | null>(null);

  const mode = edge ? asRouteMode(edge.path) : pathOf(data);
  const storedBends = edge?.bends ?? NO_BENDS;
  const paired = useMemo(
    () => (edge ? reversePartnerOf(edge, edges) !== undefined : false),
    [edge, edges],
  );
  const source = useMemo(() => ({ x: sourceX, y: sourceY }), [sourceX, sourceY]);
  const target = useMemo(() => ({ x: targetX, y: targetY }), [targetX, targetY]);
  const shift = useMemo(
    () => (paired ? pairOffset(id, source, target) : null),
    [paired, id, source, target],
  );
  // A self-loop's two anchors sit on one card, so the route needs that card's box to
  // travel around it (ADR-0061 amendment). Read from the document, not from React
  // Flow's measured nodes, so it is right before the card has painted.
  const selfLoopRect = useMemo((): LoopRect | null => {
    if (!edge || edge.source !== edge.target) return null;
    const placement = workspace.getPlacement(edge.boardId, edge.source);
    if (!placement) return null;
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width ?? DEFAULT_CARD_WIDTH,
      height: placement.height ?? DEFAULT_CARD_HEIGHT,
    };
  }, [edge, workspace]);

  const bends = useMemo(() => {
    if (!liveBend) return storedBends;
    return storedBends.map((bend, index) =>
      index === liveBend.index
        ? { x: liveBend.point.x - sourceX, y: liveBend.point.y - sourceY }
        : bend,
    );
  }, [storedBends, liveBend, sourceX, sourceY]);

  const route = useMemo(
    () =>
      drawRoute({
        id,
        source,
        target,
        sourcePosition,
        targetPosition,
        mode,
        bends,
        shift,
        obstacles,
        selfLoopRect,
      }),
    [
      id,
      source,
      target,
      sourcePosition,
      targetPosition,
      mode,
      bends,
      shift,
      obstacles,
      selfLoopRect,
    ],
  );
  const edgePath = route.path;

  /** One write per gesture: the live point is local state until the release. */
  const commitBend = useCallback(
    (index: number, at: RoutePoint) => {
      if (!edge) return;
      const next = storedBends
        .map((bend, position) =>
          position === index
            ? {
                x: round(at.x - sourceX - (shift?.x ?? 0)),
                y: round(at.y - sourceY - (shift?.y ?? 0)),
              }
            : bend,
        )
        .slice(0, MAX_BENDS);
      workspace.setEdgeRoute(id, { bends: next, layer: edge.layer });
    },
    [edge, storedBends, sourceX, sourceY, shift, workspace, id],
  );

  const beginBendDrag = (index: number) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (event.button !== 0 || !canEditLayout) return;
    // The pane would otherwise read this as the start of a camera drag.
    event.preventDefault();
    event.stopPropagation();
    const toFlow = (clientX: number, clientY: number) =>
      screenToFlowPosition({ x: clientX, y: clientY });
    setLiveBend({ index, point: toFlow(event.clientX, event.clientY) });

    const move = (moveEvent: PointerEvent) => {
      setLiveBend({ index, point: toFlow(moveEvent.clientX, moveEvent.clientY) });
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      setLiveBend(null);
      commitBend(index, toFlow(upEvent.clientX, upEvent.clientY));
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };

  const onLabelDrag = (data as Partial<EdgeDescriptionData> | undefined)?.onLabelDrag;
  const onLabelEdit = (data as Partial<EdgeDescriptionData> | undefined)?.onLabelEdit;

  // Our own drag wins; otherwise a peer's live position, then the stored one.
  const offset = live ?? dragger?.offset ?? labelOffsetOf(data);
  const anchor = pointOnPath(edgePath, offset) ?? route.mid;
  const scale = 1 / (zoom || 1);
  // The chip is centred on the path point; its halo (CSS) is what opens the gap
  // in the line, so the stroke reads as running into the label.
  const chipX = anchor.x;
  const chipY = anchor.y;

  // Isolate (ADR-0052 §7) gives this link the board to itself: everything else
  // recedes, this route stays at full strength.
  const isolated = isolatedEdgeId === id;
  const dimmed = isolatedEdgeId !== null && !isolated;
  const showBends = selected === true && canEditLayout && route.bends.length > 0;

  /** Fraction of the path under the pointer; null when it cannot be measured. */
  const fractionAt = (clientX: number, clientY: number): number | null => {
    const flow = screenToFlowPosition({ x: clientX, y: clientY });
    return nearestFractionOnPath(edgePath, flow);
  };

  return (
    <>
      <g
        className={`route-edge${dimmed ? " is-dimmed" : ""}${isolated ? " is-isolated" : ""}`}
        data-testid="route-edge"
        data-edge-id={id}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          {...(markerStart ? { markerStart } : {})}
          {...(markerEnd ? { markerEnd } : {})}
          {...(style ? { style } : {})}
          {...(interactionWidth === undefined ? {} : { interactionWidth })}
        />
        {showBends ? (
          <g className="route-bends" data-testid="route-bends">
            {route.bends.map((bend, index) => (
              <circle
                // The drawn point is the identity: bends are never coincident.
                key={`${Math.round(bend.x)}:${Math.round(bend.y)}`}
                className="route-bend nodrag nopan"
                data-testid={`route-bend-${index}`}
                cx={bend.x}
                cy={bend.y}
                r={5}
                onPointerDown={beginBendDrag(index)}
              />
            ))}
          </g>
        ) : null}
      </g>
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-description"
            data-testid="edge-description"
            style={{
              transform: `translate(${chipX}px, ${chipY}px) scale(${scale})`,
            }}
          >
            <button
              type="button"
              className="edge-description-chip"
              data-testid="edge-description-chip"
              data-dragging={live === null ? undefined : "true"}
              data-peer-name={dragger?.name}
              // The border carries the peer's colour; the text stays legible.
              {...(dragger ? { style: { borderColor: dragger.color } } : {})}
              title={`${label} — drag to move along the link`}
              onKeyDown={(event) => {
                // The keyboard path to the same editor a double click opens.
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onLabelEdit?.(id, { x: rect.left + rect.width / 2, y: rect.top });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                // The chip sits over the canvas: without this a drag would pan
                // the board or start a selection box instead of moving the label.
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragging.current = fractionAt(event.clientX, event.clientY);
                latest.current = dragging.current;
                if (dragging.current !== null) onLabelDrag?.(id, dragging.current, "start");
              }}
              onPointerMove={(event) => {
                if (dragging.current === null) return;
                const fraction = fractionAt(event.clientX, event.clientY);
                if (fraction === null) return;
                latest.current = fraction;
                setLive(fraction);
                onLabelDrag?.(id, fraction, "move");
              }}
              onPointerUp={(event) => {
                if (dragging.current === null) return;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                const final = latest.current;
                dragging.current = null;
                latest.current = null;
                setLive(null);
                if (final !== null) onLabelDrag?.(id, final, "stop");
              }}
              onPointerCancel={() => {
                dragging.current = null;
                latest.current = null;
                setLive(null);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onLabelEdit?.(id, { x: event.clientX, y: event.clientY });
              }}
            >
              {label}
              {dragger ? (
                <span className="edge-description-peer" style={{ transform: `scale(${scale})` }}>
                  <PeerNameTag user={{ name: dragger.name, color: dragger.color }} />
                </span>
              ) : null}
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes = { description: EdgeWithDescription };

export interface EdgeDescriptionInputProps {
  /** Screen position of the gesture that opened the editor. */
  x: number;
  y: number;
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Inline editor for a link description, anchored where the user double-clicked.
 * Enter and a changed blur commit, Escape and an unchanged blur cancel.
 */
export function EdgeDescriptionInput({
  x,
  y,
  value,
  onCommit,
  onCancel,
}: EdgeDescriptionInputProps) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit && draft !== value) onCommit(draft);
    else onCancel();
  };

  return (
    <input
      ref={input}
      className="edge-description-input nodrag nopan"
      data-testid="edge-description-input"
      aria-label="Arrow description"
      placeholder="Describe this link…"
      value={draft}
      style={{ left: x, top: y }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          settle(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
    />
  );
}
