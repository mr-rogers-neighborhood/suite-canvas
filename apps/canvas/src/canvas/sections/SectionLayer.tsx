import type { Connector, Rect, ResolvedSurfaceStyle, Section, StyleSide } from "@suite/graph";
import { resolveSurfaceStyle } from "@suite/graph";
import { useReactFlow, useViewport, ViewportPortal } from "@xyflow/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { PeerPresence } from "../../collab/presence";
import {
  MAGNET_RADIUS,
  magnetizeToAnchors,
  type Point,
  projectToPerimeter,
} from "../../presence/Connector";
import { PeerNameTag } from "../../presence/PeerNameTag";
import { useUiStore } from "../../store/useUiStore";
import { gestureMode, isChaining, stepLink, useLinkThreadStore } from "../links/linkThread";
import { revealConnectors } from "../NodeConnectors";
import { colourRoleVar, surfacePaintVars } from "../surfacePaint";
import { useLinkDraftStore } from "../useNodeConnectorWiring";
import type { SectionOffset } from "./sectionLayout";
import { SECTION_FILL, SECTION_STROKE } from "./sectionPalette";

type ResizeDirection = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const RESIZE_DIRECTIONS: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const MIN_WIDTH = 160;
const MIN_HEIGHT = 100;

const FILL = SECTION_FILL;

const STROKE = SECTION_STROKE;

/** One dash period. The keyframes in paint.css march exactly this far. */
const DASH_PERIOD = 12;

/** The paint record is already a set of custom properties; it can be spread. */
function paintStyle(paint: Record<string, string>): CSSProperties {
  return paint as CSSProperties;
}

/**
 * A flowing side paints a gradient strip instead of a border: a dashed border
 * cannot move its own dashes, so the strip is what the animation can carry.
 */
function dashStrip(style: ResolvedSurfaceStyle, side: StyleSide): Record<string, string> | null {
  const edge = style.sides[side];
  if (!edge || edge.paint === "solid" || edge.paint === "none") return null;
  if (!edge.flow || edge.flow === "none") return null;
  const colour = colourRoleVar(edge.colour ?? style.ink);
  const dash = edge.paint === "dotted" ? 2 : 6;
  // The gradient runs along the strip, so it repeats along the edge it sits on.
  const horizontal = side === "top" || side === "bottom";
  const gradient = `repeating-linear-gradient(${horizontal ? "90deg" : "180deg"}, ${colour} 0 ${dash}px, transparent ${dash}px ${DASH_PERIOD}px)`;
  const thickness = edge.width ?? 1;
  // Extending a period past the frame is what lets the march loop seamlessly.
  const size = horizontal
    ? `calc(100% + ${DASH_PERIOD}px) ${thickness}px`
    : `${thickness}px calc(100% + ${DASH_PERIOD}px)`;
  return { [`--paint-dash-${side}`]: gradient, [`--paint-dash-size-${side}`]: size };
}

/**
 * The paint for a section's frame, or nothing when the section has no style.
 *
 * Two things are a section's own. A style that names no background keeps the
 * section's colour wash (the resolved default is the card surface, which would
 * bleach it), and a flowing side drops its static border in favour of the strip
 * above, so the dashes are not painted twice.
 */
export function sectionPaint(section: Section): Record<string, string> {
  if (!section.style) return {};
  const resolved = resolveSurfaceStyle(section.style, "section");
  const paint = surfacePaintVars(resolved);
  if (section.style.surface === undefined) {
    paint["--paint-surface"] = FILL[section.color ?? "slate"];
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const strip = dashStrip(resolved, side);
    if (!strip) continue;
    Object.assign(paint, strip);
    paint[`--paint-border-${side}`] = "none";
  }
  return paint;
}

/** What a link dragged out of a section connector landed on. */
export interface SectionLinkTarget {
  kind: "card" | "board" | "section";
  id: string;
  /** The dot it was released on, so the line keeps the port that was aimed at. */
  connectorId?: string | undefined;
}

export interface SectionLayerProps {
  sections: Section[];
  /** Sections whose every card is off the active lens; dimmed, never hidden. */
  dimmedSectionIds?: ReadonlySet<string> | undefined;
  membership: Map<string, string>;
  offsets: Map<string, SectionOffset>;
  resizes: Map<string, Rect>;
  peers: PeerPresence[];
  selectedSectionId: string | null;
  editingSectionId: string | null;
  onSelect: (id: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onDrag: (id: string, position: { x: number; y: number }) => void;
  onDragEnd: (id: string, position: { x: number; y: number }) => void;
  onResize: (id: string, rect: Rect) => void;
  onResizeEnd: (id: string, rect: Rect) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  /** The section connector showing its dashed grab ring, if any. */
  selectedConnector?: { sectionId: string; connectorId: string } | null;
  onConnectorSelect?: (sectionId: string, connectorId: string) => void;
  /** An armed link end landed on this dot; the canvas writes the reconnect. */
  onReconnectEnd?: (
    edgeId: string,
    end: "source" | "target",
    sectionId: string,
    connectorId: string,
  ) => void;
  /** Persisted once on release, so a drag never writes to the CRDT per frame. */
  onConnectorMoveEnd?: (sectionId: string, connectorId: string, position: Point) => void;
  onConnectorContextMenu?: (
    event: React.MouseEvent,
    sectionId: string,
    connectorId: string,
  ) => void;
  /** Where a link released at this flow point should point, if anywhere. */
  resolveLinkTarget?: (point: { x: number; y: number }) => SectionLinkTarget | null;
  /**
   * A link finished from a section: either dragged out of one of its dots and
   * released on a target, or chained through a thread that may have started at
   * a card. Both ends travel, so the section is not assumed to be the source.
   */
  onLinkCommit?: (
    from: SectionLinkTarget,
    to: SectionLinkTarget,
    origin: { x: number; y: number },
  ) => void;
  /** W2: thread mode reveals the connector dots on unselected sections too. */
  chaining?: boolean;
  /** A link is being dragged, so every section shows its drop targets. */
  draftActive?: boolean;
  /** A thread is armed, so every section shows its connectors as candidates. */
  armed?: boolean;
  /** A viewer may select a section, never move, resize or rename it. */
  readOnly?: boolean;
}

export function SectionLayer({
  sections,
  dimmedSectionIds,
  membership,
  offsets,
  resizes,
  peers,
  selectedSectionId,
  editingSectionId,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDrag,
  onDragEnd,
  onResize,
  onResizeEnd,
  onContextMenu,
  selectedConnector = null,
  onConnectorSelect,
  onReconnectEnd,
  onConnectorMoveEnd,
  onConnectorContextMenu,
  resolveLinkTarget,
  onLinkCommit,
  chaining = false,
  draftActive = false,
  armed = false,
  readOnly = false,
}: SectionLayerProps) {
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const inverseZoom = 1 / (zoom || 1);
  const cleanup = useRef<(() => void) | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState("");
  // Live positions of the section connectors this client is dragging, keyed
  // `${sectionId}:${connectorId}`; the CRDT only sees the drop.
  const [liveConnectors, setLiveConnectors] = useState<Record<string, Point>>({});
  /** The link being dragged out of a section connector, in flow coordinates. */
  const [linkDraft, setLinkDraft] = useState<{ from: Point; to: Point } | null>(null);
  /**
   * The section whose *own empty area* the pointer is over. Hovering a card, a
   * header pill or a link inside the section is not this: the section only shows
   * its connectors when nothing else is under the pointer, so the innermost
   * thing wins and a section never wires up behind a card.
   */
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const setDraftActive = useLinkDraftStore((state) => state.setDraftActive);
  // The armed end, not merely whether one exists: a section dot is the origin
  // only when the arm names it, and a fan returns to that dot click after click.
  const armedEnd = useLinkThreadStore((state) => state.armed);
  const mode = useUiStore((state) => state.mode);

  // A fold is reader state: the section's stored rect is untouched, so unfolding
  // puts every member back where it was.
  const collapsedSections = useUiStore((state) => state.collapsedSections);
  const toggleSectionCollapsed = useUiStore((state) => state.toggleSectionCollapsed);

  const members = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sectionId of membership.values()) {
      counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
    }
    return counts;
  }, [membership]);

  const peerGesture = useMemo(() => {
    const map = new Map<string, PeerPresence>();
    for (const peer of peers) {
      const sectionId = peer.sectionDrag?.sectionId ?? peer.sectionResize?.sectionId;
      if (sectionId && !map.has(sectionId)) map.set(sectionId, peer);
    }
    return map;
  }, [peers]);

  const peerSelection = useMemo(() => {
    const map = new Map<string, string>();
    for (const peer of peers) {
      const sectionId = peer.selection?.sectionId;
      if (sectionId && !map.has(sectionId)) map.set(sectionId, peer.user.color);
    }
    return map;
  }, [peers]);

  useEffect(() => {
    if (!editingSectionId) return;
    const section = sections.find((entry) => entry.id === editingSectionId);
    setDraft(section?.title ?? "");
  }, [editingSectionId, sections]);

  useEffect(() => {
    if (!editingSectionId) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editingSectionId]);

  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );

  const rectFor = (section: Section): Rect => {
    const resizing = resizes.get(section.id);
    if (resizing) return resizing;
    const offset = offsets.get(section.id);
    return {
      x: section.x + (offset?.dx ?? 0),
      y: section.y + (offset?.dy ?? 0),
      width: section.width,
      height: section.height,
    };
  };

  /** The rect a folded section is painted with: its own width, header height. */
  const FOLDED_SECTION_HEIGHT = 34;

  const paintRect = (section: Section): Rect => {
    const rect = rectFor(section);
    if (collapsedSections[section.id] !== true) return rect;
    return { ...rect, height: Math.min(rect.height, FOLDED_SECTION_HEIGHT) };
  };

  const startWindowGesture = (
    move: (event: PointerEvent) => void,
    end: (event: PointerEvent) => void,
  ) => {
    cleanup.current?.();
    const onMove = (event: PointerEvent) => move(event);
    const onUp = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      cleanup.current = null;
      end(event);
    };
    // Capture phase: canvas panning/selection handlers must not swallow the
    // release before the gesture can commit.
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  };

  const startDrag = (event: React.PointerEvent, section: Section) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(section.id);
    if (readOnly || editingSectionId === section.id) return;

    const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const origin = { x: section.x, y: section.y };
    const positionAt = (pointer: PointerEvent) => {
      const current = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      return {
        x: origin.x + current.x - start.x,
        y: origin.y + current.y - start.y,
      };
    };

    startWindowGesture(
      (pointer) => onDrag(section.id, positionAt(pointer)),
      (pointer) => onDragEnd(section.id, positionAt(pointer)),
    );
  };

  const startResize = (event: React.PointerEvent, section: Section, direction: ResizeDirection) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(section.id);

    const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const base = rectFor(section);
    const rectAt = (pointer: PointerEvent): Rect => {
      const current = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      let { x, y, width, height } = base;

      if (direction.includes("e")) width = Math.max(MIN_WIDTH, base.width + dx);
      if (direction.includes("s")) height = Math.max(MIN_HEIGHT, base.height + dy);
      if (direction.includes("w")) {
        width = Math.max(MIN_WIDTH, base.width - dx);
        x = base.x + base.width - width;
      }
      if (direction.includes("n")) {
        height = Math.max(MIN_HEIGHT, base.height - dy);
        y = base.y + base.height - height;
      }
      return { x, y, width, height };
    };

    startWindowGesture(
      (pointer) => onResize(section.id, rectAt(pointer)),
      (pointer) => onResizeEnd(section.id, rectAt(pointer)),
    );
  };

  /**
   * A link dragged out of a section connector. Sections are not React Flow
   * nodes, so there is no handle for React Flow to start a connection from: the
   * gesture, its preview and the drop resolution all live here.
   */
  const startConnectorLink = (
    event: React.PointerEvent,
    section: Section,
    connector: Connector,
  ) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // A link end was armed in the inspector: this dot is its new home, so the
    // press re-attaches it instead of starting a link drag.
    const moving = useUiStore.getState().linkEndMove;
    if (moving) {
      onReconnectEnd?.(moving.edgeId, moving.end, section.id, connector.id);
      useUiStore.getState().cancelLinkEndMove();
      onConnectorSelect?.(section.id, connector.id);
      return;
    }
    onConnectorSelect?.(section.id, connector.id);

    const rect = rectFor(section);
    const position = liveConnectors[`${section.id}:${connector.id}`] ?? connector;
    const origin = { x: rect.x + rect.width * position.x, y: rect.y + rect.height * position.y };
    setLinkDraft({ from: origin, to: origin });
    setDraftActive(true);

    const flowPoint = (pointer: PointerEvent) =>
      screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });

    startWindowGesture(
      (pointer) => {
        const to = flowPoint(pointer);
        setLinkDraft({ from: origin, to });
      },
      (pointer) => {
        const to = flowPoint(pointer);
        const hit = resolveLinkTarget?.(to) ?? null;
        // A release on the section itself is not a target. Its own body is
        // always under its own dot, and releasing on the dot it started from is
        // a click, not a drop — treating either as one made every click on a
        // section connector a refused self-link, so nothing ever chained.
        const onSelf =
          hit?.kind === "section" &&
          hit.id === section.id &&
          (hit.connectorId === undefined || hit.connectorId === connector.id);
        const target = onSelf ? null : hit;
        setLinkDraft(null);
        setDraftActive(false);
        if (target) {
          onLinkCommit?.(
            { kind: "section", id: section.id, connectorId: connector.id },
            target,
            origin,
          );
          useLinkThreadStore.getState().clear();
          return;
        }
        // Released without a target: in chaining mode that is a click, so the
        // section connector takes part in a thread like a card's does.
        if (!isChaining({ shiftKey: pointer.shiftKey, ctrlKey: pointer.ctrlKey, mode })) {
          return;
        }
        const clicked = { kind: "section" as const, id: section.id, connectorId: connector.id };
        // A fan keeps its origin, a thread moves to the connector just clicked.
        const gesture = gestureMode({
          shiftKey: pointer.shiftKey,
          ctrlKey: pointer.ctrlKey,
          mode,
        });
        const step = stepLink(gesture, useLinkThreadStore.getState().armed, clicked);
        if (step.link) {
          // The thread may have started on a card, so both ends come from it.
          onLinkCommit?.(step.link.from, step.link.to, origin);
        }
        // A mode chosen in the control outlives the key; a modifier's does not.
        useLinkThreadStore.getState().arm(step.armed, gesture === mode ? "mode" : "gesture");
      },
    );
  };

  const startConnectorMove = (
    event: React.PointerEvent,
    section: Section,
    connector: Connector,
  ) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onConnectorSelect?.(section.id, connector.id);

    const rect = rectFor(section);
    const key = `${section.id}:${connector.id}`;
    // The magnet radius is a screen distance, so scale it into flow units;
    // otherwise a zoomed-in board would snap from far away.
    const radius = MAGNET_RADIUS / (zoom || 1);
    const positionAt = (pointer: PointerEvent) => {
      const point = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      return magnetizeToAnchors(projectToPerimeter(rect, point), rect, radius);
    };

    startWindowGesture(
      (pointer) => setLiveConnectors((live) => ({ ...live, [key]: positionAt(pointer) })),
      (pointer) => {
        const position = positionAt(pointer);
        setLiveConnectors((live) => {
          const next = { ...live };
          delete next[key];
          return next;
        });
        onConnectorMoveEnd?.(section.id, connector.id, position);
      },
    );
  };

  const commitTitle = (section: Section) => {
    onCommitRename(section.id, draft);
  };

  return (
    <>
      <ViewportPortal>
        <div className="section-background-layer" data-testid="section-background-layer">
          {sections.map((section) => {
            const rect = paintRect(section);
            const color = section.color ?? "slate";
            const selected = selectedSectionId === section.id;
            const peerColor = peerSelection.get(section.id);
            const paint = sectionPaint(section);
            const painted = Object.keys(paint).length > 0;
            return (
              <button
                key={section.id}
                type="button"
                aria-label={`Section: ${section.title || "Untitled section"}`}
                data-testid={`section-region-${section.id}`}
                className={`section-region${selected ? " is-selected" : ""}${
                  dimmedSectionIds?.has(section.id) ? " is-off-lens" : ""
                }${painted ? " is-painted" : ""}`}
                style={
                  {
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height,
                    // An unstyled frame keeps the section's own colour wash; a
                    // painted one takes its background from the style instead.
                    ...(painted ? {} : { background: FILL[color] }),
                    borderColor: selected ? STROKE[color] : undefined,
                    ...(peerColor ? { boxShadow: `0 0 0 2px ${peerColor}66` } : {}),
                    ...(peerGesture.has(section.id)
                      ? {
                          transition:
                            "left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear",
                        }
                      : {}),
                    ...paintStyle(paint),
                  } as CSSProperties
                }
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(section.id);
                }}
                onPointerEnter={() => setHoveredSectionId(section.id)}
                onPointerLeave={() =>
                  setHoveredSectionId((current) => (current === section.id ? null : current))
                }
                onContextMenu={(event) => onContextMenu(event, section.id)}
              />
            );
          })}
        </div>
      </ViewportPortal>

      <ViewportPortal>
        {/* Section connectors ride the same perimeter maths as card dots, drawn
            here because a section is not a React Flow node. Like a card's dots
            they appear on selection (or in thread mode), never permanently. */}
        <div className="section-connector-layer" data-testid="section-connector-layer">
          {sections
            .filter((section) =>
              // The same predicate the node faces use, so section dots cannot
              // follow a different reveal rule than a card's.
              revealConnectors({
                selected: section.id === selectedSectionId,
                chaining,
                draftActive,
                armed,
                hovered: section.id === hoveredSectionId,
              }),
            )
            .flatMap((section) => {
              const rect = rectFor(section);
              return (section.connectors ?? []).map((connector) => {
                const key = `${section.id}:${connector.id}`;
                const position = liveConnectors[key] ?? connector;
                const selected =
                  selectedConnector?.sectionId === section.id &&
                  selectedConnector.connectorId === connector.id;
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: the dot is a canvas control; its menu and drag are pointer gestures on a flow-space marker.
                  <div
                    key={key}
                    data-testid="section-connector"
                    data-section-id={section.id}
                    data-connector-id={connector.id}
                    data-selected={selected ? "true" : undefined}
                    data-armed={
                      armedEnd?.kind === "section" &&
                      armedEnd.id === section.id &&
                      armedEnd.connectorId === connector.id
                        ? "true"
                        : undefined
                    }
                    className="section-connector nokey"
                    style={{
                      left: rect.x + rect.width * position.x,
                      top: rect.y + rect.height * position.y,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onConnectorSelect?.(section.id, connector.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (readOnly) return;
                      onConnectorContextMenu?.(event, section.id, connector.id);
                    }}
                  >
                    <div
                      className="section-connector__chrome"
                      style={{ transform: `scale(${inverseZoom})` }}
                    >
                      <button
                        type="button"
                        data-testid="section-connector-dot"
                        aria-label="Draw a link from this connector"
                        className="section-connector__dot"
                        // The dot draws a link. It must never also start the
                        // section drag, so the press is claimed here.
                        onPointerDown={(event) => startConnectorLink(event, section, connector)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onConnectorContextMenu?.(event, section.id, connector.id);
                        }}
                      />
                      {selected ? (
                        <button
                          type="button"
                          aria-label="Move connector"
                          data-testid="section-connector-grab"
                          className="connector-grab -translate-x-1/2 -translate-y-1/2"
                          title="Move connector"
                          onPointerDown={(event) => startConnectorMove(event, section, connector)}
                          onClick={(event) => event.stopPropagation()}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onConnectorContextMenu?.(event, section.id, connector.id);
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              });
            })}
        </div>
        {linkDraft ? (
          <svg className="section-link-preview-layer" aria-hidden="true" focusable="false">
            <line
              className="section-link-preview"
              x1={linkDraft.from.x}
              y1={linkDraft.from.y}
              x2={linkDraft.to.x}
              y2={linkDraft.to.y}
            />
            <circle
              className="section-link-preview__origin"
              cx={linkDraft.from.x}
              cy={linkDraft.from.y}
              r={4}
            />
          </svg>
        ) : null}
      </ViewportPortal>

      <ViewportPortal>
        <div className="section-header-layer" data-testid="section-header-layer">
          {sections.map((section) => {
            const rect = paintRect(section);
            const color = section.color ?? "slate";
            const selected = selectedSectionId === section.id;
            const peer = peerGesture.get(section.id);
            const count = members.get(section.id) ?? 0;
            const paint = sectionPaint(section);
            const painted = Object.keys(paint).length > 0;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: the header is the section's drag handle; its title and rename field are separate controls.
              <div
                key={section.id}
                data-testid={`section-header-${section.id}`}
                className={`section-header${dimmedSectionIds?.has(section.id) ? " is-off-lens" : ""}${
                  painted ? " is-painted" : ""
                }`}
                style={
                  {
                    left: rect.x + 8,
                    top: rect.y + 6,
                    transform: `scale(${inverseZoom})`,
                    borderColor: selected ? STROKE[color] : undefined,
                    ...(peer ? { transition: "left 60ms linear, top 60ms linear" } : {}),
                    // The pill follows the section's ink so the title stays
                    // readable on a painted frame.
                    ...(painted ? { "--paint-ink": paint["--paint-ink"] } : {}),
                  } as CSSProperties
                }
                onPointerDown={(event) => startDrag(event, section)}
                onContextMenu={(event) => onContextMenu(event, section.id)}
              >
                <span
                  aria-hidden="true"
                  className="section-color-dot"
                  style={{ backgroundColor: STROKE[color] }}
                />
                {editingSectionId === section.id ? (
                  <input
                    ref={editingSectionId === section.id ? titleInput : undefined}
                    value={draft}
                    aria-label="Section title"
                    data-testid="section-title-input"
                    className="section-title-input nodrag"
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitTitle(section)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        commitTitle(section);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraft(section.title);
                        onCancelRename();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="section-title"
                    aria-label={`Section: ${section.title || "Untitled section"}`}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (readOnly) return;
                      onStartRename(section.id);
                    }}
                  >
                    {section.title || "Untitled section"}
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`section-fold-${section.id}`}
                  aria-label={
                    collapsedSections[section.id] === true
                      ? `Expand section ${section.title || "Untitled section"}`
                      : `Collapse section ${section.title || "Untitled section"}`
                  }
                  aria-expanded={collapsedSections[section.id] !== true}
                  title={
                    collapsedSections[section.id] === true ? "Expand section" : "Collapse section"
                  }
                  className="section-fold nodrag"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSectionCollapsed(section.id);
                  }}
                >
                  <span aria-hidden="true">
                    {collapsedSections[section.id] === true ? "\u25b8" : "\u25be"}
                  </span>
                </button>
                <span className="section-count">{count}</span>
                {peer ? <PeerNameTag user={peer.user} /> : null}
              </div>
            );
          })}

          {sections
            .filter(
              (section) =>
                !readOnly &&
                section.id === selectedSectionId &&
                collapsedSections[section.id] !== true,
            )
            .flatMap((section) => {
              const rect = rectFor(section);
              return RESIZE_DIRECTIONS.map((direction) => {
                const style = resizeHandleStyle(direction, rect, inverseZoom);
                return (
                  <span
                    key={`${section.id}:${direction}`}
                    data-testid={`section-handle-${direction}`}
                    data-direction={direction}
                    className="section-resize-handle"
                    style={style}
                    onPointerDown={(event) => startResize(event, section, direction)}
                  />
                );
              });
            })}
        </div>
      </ViewportPortal>
    </>
  );
}

function resizeHandleStyle(direction: ResizeDirection, rect: Rect, inverseZoom: number) {
  const size = 9 * inverseZoom;
  const half = size / 2;
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 2 * inverseZoom,
  };
  if (direction.includes("n")) style.top = rect.y - half;
  if (direction.includes("s")) style.top = rect.y + rect.height - half;
  if (!direction.includes("n") && !direction.includes("s")) {
    style.top = rect.y + rect.height / 2 - half;
  }
  if (direction.includes("w")) style.left = rect.x - half;
  if (direction.includes("e")) style.left = rect.x + rect.width - half;
  if (!direction.includes("w") && !direction.includes("e")) {
    style.left = rect.x + rect.width / 2 - half;
  }
  return style;
}
