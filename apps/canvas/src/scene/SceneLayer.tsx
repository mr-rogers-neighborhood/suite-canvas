import type { Card, CardType, Drawing, EdgePath, Tag } from "@suite/graph";
import {
  type BoardInstance,
  boardInstanceKey,
  type CardInstance,
  type EdgeInstance,
  edgeRoutePolyline,
  type Point,
  type PortalInstance,
  RESIZE_HANDLES,
  type Rect,
  type ResizeHandle,
  rectIntersects,
  type Scene,
  type SectionInstance,
} from "@suite/scene";
import { type CSSProperties, useCallback, useMemo } from "react";
import { BoardMiniature } from "../canvas/BoardMiniature";
import type { BoardMiniatureModel } from "../canvas/portalMiniature";
import { type CardMeta, cardMeta } from "../cards/cardMeta";
import { FALLBACK_CARD_TYPE, resolveCardType } from "../cards/cardTypes";
import { WhiteboardPreview } from "../cards/WhiteboardPreview";
import { isWhiteboardCard } from "../cards/whiteboard";
import type { PeerPresence } from "../collab/presence";
import { PeerNameTag } from "../components/PeerNameTag";
import { SceneCardView } from "./SceneCardView";
import { peerGhosts, peerPointerDots, peerSelectionOutlines } from "./scenePresence";
import {
  resizeHandleBoxes,
  resizeHandleCursor,
  resizeHandlePageSize,
  resolveResizeTarget,
  resolveSectionResizeTarget,
  type SceneConnectorHandle,
  sceneChromeScale,
} from "./sceneSelection";
import "./sceneLayer.css";

export interface SceneLayerProps {
  scene: Scene;
  /** Visible page-space box; instances outside it are not rendered. */
  viewport: Rect;
  /** Canonical cards, used for the glyph, title fallback and property chips. */
  cards?: ReadonlyMap<string, Card>;
  types?: Map<string, CardType>;
  tags?: Map<string, Tag>;
  /** Target-board miniatures for collapsed portals, keyed by board id. */
  miniatures?: ReadonlyMap<string, BoardMiniatureModel>;
  /** Whiteboard scenes, keyed by card id. */
  drawings?: ReadonlyMap<string, Drawing>;
  /** Enter a portal by focusing its child board, never by switching boards. */
  onFocusPortal?: ((portal: PortalInstance) => void) | undefined;
  /** Canonical card ids selected in the shared UI store. */
  selectedIds?: readonly string[];
  /** Canonical section id selected on the surface, if any. */
  selectedSectionId?: string | null;
  /** Canonical edge ids selected on the surface. */
  selectedEdgeIds?: readonly string[];
  /** Live page-space boxes keyed by instance key while a gesture runs. */
  overrides?: ReadonlyMap<string, Rect>;
  /** Page-space marquee rectangle while a marquee gesture runs. */
  marquee?: Rect | null;
  /** Side-midpoint handles of a single selected card, in page space. */
  connectorHandles?: readonly SceneConnectorHandle[];
  /** Live connector line while a handle is dragged. */
  connectorDrag?: { readonly from: Point; readonly to: Point } | null;
  /** Resize handles only appear for editors, never for a read-only viewer. */
  canEditLayout?: boolean;
  /** Mount real NodeCard/Tiptap faces at full LOD (needs a ReactFlowProvider ancestor). */
  liveCards?: boolean;
  /** Peers looking at the root board; their presence paints over the projection. */
  peers?: readonly PeerPresence[];
}

interface BoardContent {
  cards: CardInstance[];
  sections: SectionInstance[];
  edges: EdgeInstance[];
  portals: PortalInstance[];
  portalZ: Map<string, number>;
}

interface SceneLayerContext {
  content: ReadonlyMap<string, BoardContent>;
  boards: ReadonlyMap<string, BoardInstance>;
  cards: ReadonlyMap<string, Card> | undefined;
  types: Map<string, CardType> | undefined;
  tags: Map<string, Tag> | undefined;
  miniatures: ReadonlyMap<string, BoardMiniatureModel> | undefined;
  drawings: ReadonlyMap<string, Drawing> | undefined;
  onFocusPortal: ((portal: PortalInstance) => void) | undefined;
  viewport: Rect;
  culling: boolean;
  /** Live gesture rect for an instance, or its canonical box. */
  rectFor: (instanceKey: string, rect: Rect) => Rect;
  /** Canonical card ids the shared store has selected. */
  selected: ReadonlySet<string>;
  /** Canonical edge ids the shared store has selected. */
  selectedEdges: ReadonlySet<string>;
  /** Canonical section id the shared store has selected. */
  selectedSectionId: string | null;
  liveCards: boolean;
}

const ORIGIN: Point = { x: 0, y: 0 };
const EMPTY_META: CardMeta = { properties: [], tags: [] };
const EMPTY_IDS: readonly string[] = [];
const EMPTY_OVERRIDES: ReadonlyMap<string, Rect> = new Map();
const EMPTY_HANDLES: readonly SceneConnectorHandle[] = [];
const EMPTY_PEERS: readonly PeerPresence[] = [];

function indexScene(scene: Scene): Map<string, BoardContent> {
  const content = new Map<string, BoardContent>();
  const bucket = (boardKey: string): BoardContent => {
    const existing = content.get(boardKey);
    if (existing) return existing;
    const next: BoardContent = {
      cards: [],
      sections: [],
      edges: [],
      portals: [],
      portalZ: new Map(),
    };
    content.set(boardKey, next);
    return next;
  };

  for (const card of scene.cards) bucket(card.boardKey).cards.push(card);
  for (const section of scene.sections) bucket(section.boardKey).sections.push(section);
  for (const edge of scene.edges) bucket(edge.boardKey).edges.push(edge);
  for (const portal of scene.portals) {
    const board = bucket(boardInstanceKey(portal.path));
    board.portals.push(portal);
    const card = board.cards.find(
      (candidate) => candidate.cardId === portal.cardId && candidate.portalKey !== null,
    );
    board.portalZ.set(portal.key, card?.z ?? 0);
  }
  return content;
}

function translated(rect: Rect, origin: Point, fontSize?: number): CSSProperties {
  return {
    position: "absolute",
    left: rect.x - origin.x,
    top: rect.y - origin.y,
    width: rect.width,
    height: rect.height,
    ...(fontSize === undefined ? {} : { fontSize }),
  };
}

function isShown(context: SceneLayerContext, rect: Rect): boolean {
  return !context.culling || rectIntersects(rect, context.viewport);
}

function edgePath(from: Point, to: Point, route: EdgePath): string {
  if (route === "straight") return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  if (route === "step" || route === "smoothstep") {
    const middle = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} L ${middle} ${from.y} L ${middle} ${to.y} L ${to.x} ${to.y}`;
  }
  const pull = Math.max(40, Math.abs(to.x - from.x) * 0.4);
  return `M ${from.x} ${from.y} C ${from.x + pull} ${from.y}, ${to.x - pull} ${to.y}, ${to.x} ${to.y}`;
}

/**
 * Halfway point along the drawn route, so a label sits on the line for every
 * path kind instead of always at the straight midpoint.
 */
function edgeLabelPoint(edge: EdgeInstance): Point {
  const points = edgeRoutePolyline(edge.from, edge.to, edge.route);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return edge.from;
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a && b) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (total <= 0) return first;
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + length >= total / 2) {
      const t = length === 0 ? 0 : (total / 2 - travelled) / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += length;
  }
  return last;
}

/**
 * Edges paint above sections and below cards, at the same LOD the projection
 * chose. A selected edge is redrawn on top so its highlight is never covered.
 */
function EdgeLayer({
  edges,
  origin,
  strokeWidth,
  selected,
  fontSize,
}: {
  edges: readonly EdgeInstance[];
  origin: Point;
  strokeWidth: number;
  selected: ReadonlySet<string>;
  fontSize: number;
}) {
  const ordered = useMemo(
    () =>
      [...edges].sort((a, b) => Number(selected.has(a.edgeId)) - Number(selected.has(b.edgeId))),
    [edges, selected],
  );

  return (
    <svg
      className="scene-edges"
      data-testid="scene-edges"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: "visible",
      }}
    >
      {ordered.map((edge) => (
        <path
          key={edge.key}
          className="scene-edge"
          data-testid={selected.has(edge.edgeId) ? "scene-edge-selected" : "scene-edge"}
          data-edge-id={edge.edgeId}
          data-selected={selected.has(edge.edgeId) ? "true" : undefined}
          d={edgePath(
            { x: edge.from.x - origin.x, y: edge.from.y - origin.y },
            { x: edge.to.x - origin.x, y: edge.to.y - origin.y },
            edge.route,
          )}
          strokeWidth={selected.has(edge.edgeId) ? strokeWidth * 2 : strokeWidth}
        />
      ))}
      {ordered.map((edge) => {
        if (!edge.label) return null;
        const point = edgeLabelPoint(edge);
        return (
          <text
            key={`${edge.key}:label`}
            className="scene-edge__label"
            data-testid="scene-edge-label"
            data-edge-id={edge.edgeId}
            x={point.x - origin.x}
            y={point.y - origin.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={fontSize}
          >
            {edge.label}
          </text>
        );
      })}
    </svg>
  );
}

function SectionView({
  section,
  rect,
  origin,
  scale,
  selected,
}: {
  section: SectionInstance;
  rect: Rect;
  origin: Point;
  scale: number;
  selected: boolean;
}) {
  const color = section.color ?? "slate";
  return (
    <div
      className="scene-section"
      data-testid="scene-section"
      data-section-id={section.sectionId}
      data-lod={section.lod}
      data-selected={selected ? "true" : undefined}
      style={
        {
          ...translated(rect, origin, 11 * scale),
          "--scene-section-color": `var(--section-${color})`,
          zIndex: Math.round(section.z),
        } as CSSProperties
      }
    >
      <span className="scene-section__title">{section.title.trim() || "Untitled section"}</span>
    </div>
  );
}

function CardFace({
  card,
  context,
  origin,
  scale,
}: {
  card: CardInstance;
  context: SceneLayerContext;
  origin: Point;
  scale: number;
}) {
  const model = context.cards?.get(card.cardId);
  const type = context.types
    ? resolveCardType(context.types, model?.primaryTypeId ?? FALLBACK_CARD_TYPE.id)
    : FALLBACK_CARD_TYPE;
  const meta: CardMeta =
    model && context.types && context.tags
      ? cardMeta(model, context.types, context.tags, 3)
      : EMPTY_META;
  const title = card.title ?? "Untitled";
  const drawing = context.drawings?.get(card.cardId);

  if (card.lod === "full" && context.liveCards && model && context.types && context.tags) {
    const rect = context.rectFor(card.key, card.rect);
    const boardScale = card.transform.scale;
    return (
      <div
        className="scene-card scene-card--full scene-card--live"
        data-testid="scene-card"
        data-card-id={card.cardId}
        data-lod={card.lod}
        style={{ ...translated(rect, origin), zIndex: 2000 + Math.round(card.z) }}
      >
        <div
          className="scene-card__scale"
          style={{
            width: card.local.width,
            height: card.local.height,
            transform: `scale(${boardScale})`,
            transformOrigin: "top left",
          }}
        >
          <SceneCardView
            card={model}
            type={type}
            meta={meta}
            boardId={card.boardId}
            width={card.local.width}
            height={card.local.height}
            selected={context.selected.has(card.cardId)}
          />
        </div>
      </div>
    );
  }

  if (card.lod === "full") {
    return (
      <div
        className="scene-card scene-card--full"
        data-testid="scene-card"
        data-card-id={card.cardId}
        data-lod={card.lod}
        style={{
          ...translated(context.rectFor(card.key, card.rect), origin, 13 * scale),
          zIndex: 2000 + Math.round(card.z),
        }}
      >
        <div className="scene-card__header">
          <span className="scene-card__glyph" aria-hidden="true">
            {type.glyph}
          </span>
          <span className="scene-card__title">{title}</span>
        </div>
        {meta.properties.length > 0 || meta.tags.length > 0 ? (
          <div className="scene-card__meta">
            {meta.properties.map((property) => (
              <span key={property.fieldId} className="scene-card__chip">
                {property.label}: {property.value}
              </span>
            ))}
            {meta.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="scene-card__chip scene-card__chip--tag">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        {isWhiteboardCard(model) ? (
          <div className="scene-card__body scene-card__body--drawing">
            <WhiteboardPreview
              elements={drawing?.elements ?? []}
              label={`${title} preview`}
              className="scene-card__drawing"
            />
          </div>
        ) : (
          <div className="scene-card__body" aria-hidden="true">
            <span className="scene-card__line" />
            <span className="scene-card__line scene-card__line--short" />
            <span className="scene-card__line" />
          </div>
        )}
      </div>
    );
  }

  if (card.lod === "compact") {
    return (
      <div
        className="scene-card scene-card--compact"
        data-testid="scene-card"
        data-card-id={card.cardId}
        data-lod={card.lod}
        style={{
          ...translated(context.rectFor(card.key, card.rect), origin, 12 * scale),
          zIndex: 2000 + Math.round(card.z),
        }}
      >
        <span className="scene-card__glyph" aria-hidden="true">
          {type.glyph}
        </span>
        <span className="scene-card__title">{title}</span>
      </div>
    );
  }

  if (card.lod === "icon") {
    return (
      <div
        className="scene-card scene-card--icon"
        data-testid="scene-card"
        data-card-id={card.cardId}
        data-lod={card.lod}
        style={{
          ...translated(context.rectFor(card.key, card.rect), origin, 18 * scale),
          zIndex: 2000 + Math.round(card.z),
        }}
      >
        <span className="scene-card__glyph" aria-hidden="true">
          {type.glyph}
        </span>
      </div>
    );
  }

  return null;
}

function PortalFace({ portal, context }: { portal: PortalInstance; context: SceneLayerContext }) {
  const name = portal.targetBoardName ?? "Unavailable board";
  const title = portal.title ?? name;
  const model = context.miniatures?.get(portal.targetBoardId);
  const status = portal.cycle
    ? "Cycle"
    : portal.depthCapped
      ? "Depth limit"
      : portal.targetMissing
        ? "No target"
        : `${model?.cardCount ?? 0} card${model?.cardCount === 1 ? "" : "s"}`;

  return (
    <>
      <div className="scene-portal__header">
        <span className="scene-portal__glyph" aria-hidden="true">
          {"\u25c9"}
        </span>
        <span className="scene-portal__title">{title}</span>
        <span className="scene-portal__status">{status}</span>
      </div>
      <div className="scene-portal__preview" data-testid="scene-portal-impostor">
        {portal.targetMissing ? (
          <span className="scene-portal__placeholder">Unavailable board</span>
        ) : model ? (
          <span aria-hidden="true">
            <BoardMiniature model={model} label={`${name} miniature`} />
          </span>
        ) : (
          <span className="scene-portal__placeholder">{name}</span>
        )}
      </div>
      <div className="scene-portal__footer">
        <span>{name}</span>
        <span className="scene-portal__count">{status}</span>
      </div>
    </>
  );
}

function PortalView({
  portal,
  context,
  origin,
}: {
  portal: PortalInstance;
  context: SceneLayerContext;
  origin: Point;
}) {
  const scale = portal.transform.scale;
  const frame = context.rectFor(portal.key, portal.frame);
  const focus = context.onFocusPortal;
  const canFocus = focus !== undefined && !portal.targetMissing;
  const focusPortal = () => {
    if (canFocus) focus(portal);
  };
  const board = portal.childKey ? context.boards.get(portal.childKey) : undefined;
  const name = portal.targetBoardName ?? board?.name ?? "board";
  const cardZ = Math.round(
    context.content.get(boardInstanceKey(portal.path))?.portalZ.get(portal.key) ?? 0,
  );
  const common = {
    "data-testid": "scene-portal",
    "data-card-id": portal.cardId,
    "data-target-board-id": portal.targetBoardId,
    "data-expanded": portal.expanded ? "true" : "false",
    "data-reason": portal.reason,
    "data-lod": portal.lod,
    "data-cycle": portal.cycle ? "true" : undefined,
    "data-depth-capped": portal.depthCapped ? "true" : undefined,
    "data-target-missing": portal.targetMissing ? "true" : undefined,
  } as const;

  if (portal.expanded && board) {
    return (
      <div
        {...common}
        className="scene-portal scene-portal--live"
        style={{ ...translated(frame, origin, 12 * scale), zIndex: 2000 + cardZ }}
      >
        <div className="scene-portal__clip" data-testid="scene-portal-child">
          <BoardView context={context} board={board} origin={portal.frame} />
        </div>
        <button
          type="button"
          className="scene-portal__header scene-portal__header--live"
          disabled={!canFocus}
          onClick={focusPortal}
        >
          <span className="sr-only">Focus </span>
          <span className="scene-portal__glyph" aria-hidden="true">
            {"\u25c9"}
          </span>
          <span className="scene-portal__title">{portal.title ?? board.name}</span>
          <span className="scene-portal__status">Live</span>
        </button>
      </div>
    );
  }

  return (
    <div
      {...common}
      className="scene-portal scene-portal--impostor"
      data-interactive={canFocus ? "true" : undefined}
      style={{ ...translated(frame, origin, 12 * scale), zIndex: 2000 + cardZ }}
    >
      {canFocus ? (
        <button
          type="button"
          className="scene-portal__focus-target"
          aria-label={`Focus ${name}`}
          onClick={focusPortal}
        />
      ) : null}
      <PortalFace portal={portal} context={context} />
    </div>
  );
}

function BoardView({
  context,
  board,
  origin,
}: {
  context: SceneLayerContext;
  board: BoardInstance;
  origin: Point;
}) {
  if (board.lod === "hidden") return null;
  const content = context.content.get(board.key);
  if (!content) return null;

  const scale = board.transform.scale;
  const cards = content.cards.filter(
    (card) =>
      card.portalKey === null &&
      card.lod !== "hidden" &&
      isShown(context, context.rectFor(card.key, card.rect)),
  );
  const sections = content.sections.filter(
    (section) =>
      section.lod !== "hidden" && isShown(context, context.rectFor(section.key, section.rect)),
  );
  const edges = content.edges.filter(
    (edge) => edge.lod !== "hidden" && isShown(context, edge.bounds),
  );
  const portals = content.portals.filter(
    (portal) =>
      portal.lod !== "hidden" && isShown(context, context.rectFor(portal.key, portal.frame)),
  );

  return (
    <div
      className="scene-board-content"
      data-board-key={board.key}
      data-board-id={board.boardId}
      data-lod={board.lod}
    >
      {sections.map((section) => (
        <SectionView
          key={section.key}
          section={section}
          rect={context.rectFor(section.key, section.rect)}
          origin={origin}
          scale={scale}
          selected={section.sectionId === context.selectedSectionId}
        />
      ))}
      {edges.length > 0 ? (
        <EdgeLayer
          edges={edges}
          origin={origin}
          strokeWidth={Math.max(0.5, 1.4 * scale)}
          selected={context.selectedEdges}
          fontSize={Math.max(8, 11 * scale)}
        />
      ) : null}
      {cards.map((card) => (
        <CardFace key={card.key} card={card} context={context} origin={origin} scale={scale} />
      ))}
      {portals.map((portal) => (
        <PortalView key={portal.key} portal={portal} context={context} origin={origin} />
      ))}
    </div>
  );
}

/** Page-space overlay box; selection chrome renders at the layer's origin. */
function pageBox(rect: Rect): CSSProperties {
  return {
    position: "absolute",
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

interface SelectionOutline {
  readonly instanceKey: string;
  readonly cardId: string;
  readonly rect: Rect;
}

function selectionOutlines(scene: Scene, context: SceneLayerContext): SelectionOutline[] {
  const outlines: SelectionOutline[] = [];
  for (const card of scene.cards) {
    // Portal cards are outlined by their frame, not the card box underneath it.
    if (card.portalKey !== null || card.lod === "hidden") continue;
    if (!context.selected.has(card.cardId)) continue;
    outlines.push({
      instanceKey: card.key,
      cardId: card.cardId,
      rect: context.rectFor(card.key, card.rect),
    });
  }
  for (const portal of scene.portals) {
    if (portal.lod === "hidden" || !context.selected.has(portal.cardId)) continue;
    outlines.push({
      instanceKey: portal.key,
      cardId: portal.cardId,
      rect: context.rectFor(portal.key, portal.frame),
    });
  }
  return outlines;
}

/**
 * Selected outline, resize handles, connector handles and the live marquee.
 * All boxes are page space, so the overlay pans and zooms with the scene
 * without extra math. Handles exist for a single readable card or a selected
 * section, and only for editors.
 */
function SelectionOverlay({
  scene,
  context,
  selectedIds,
  selectedSectionId,
  marquee,
  canEditLayout,
  connectorHandles,
  connectorDrag,
}: {
  scene: Scene;
  context: SceneLayerContext;
  selectedIds: readonly string[];
  selectedSectionId: string | null;
  marquee: Rect | null;
  canEditLayout: boolean;
  connectorHandles: readonly SceneConnectorHandle[];
  connectorDrag: { readonly from: Point; readonly to: Point } | null;
}) {
  const outlines = selectedIds.length === 0 ? [] : selectionOutlines(scene, context);
  const cardTarget = canEditLayout ? resolveResizeTarget(scene, selectedIds) : null;
  const sectionTarget = canEditLayout ? resolveSectionResizeTarget(scene, selectedSectionId) : null;
  const handleSize = resizeHandlePageSize(scene.camera.zoom);
  const handles: { key: string; handle: ResizeHandle; rect: Rect; lod: string }[] = [];
  for (const target of [cardTarget, sectionTarget]) {
    if (!target) continue;
    const rect = context.rectFor(target.instanceKey, target.rect);
    for (const handle of RESIZE_HANDLES) {
      handles.push({
        key: `${target.instanceKey}:${handle}`,
        handle,
        rect: resizeHandleBoxes(rect, handleSize)[handle],
        lod: target.lod,
      });
    }
  }

  const empty =
    outlines.length === 0 &&
    handles.length === 0 &&
    marquee === null &&
    connectorHandles.length === 0 &&
    connectorDrag === null;
  if (empty) return null;

  return (
    <div
      className="scene-selection"
      data-testid="scene-selection"
      aria-hidden="true"
      style={{ "--scene-chrome-scale": sceneChromeScale(scene.camera.zoom) } as CSSProperties}
    >
      {outlines.map((outline) => (
        <div
          key={outline.instanceKey}
          className="scene-selection__outline"
          data-testid="scene-selection-outline"
          data-card-id={outline.cardId}
          style={pageBox(outline.rect)}
        />
      ))}
      {connectorHandles.map((handle) => (
        <span
          key={handle.key}
          className="scene-selection__connector"
          data-testid="scene-connector-handle"
          data-side={handle.side}
          data-card-id={handle.cardId}
          {...(handle.connectorId === null ? {} : { "data-connector-id": handle.connectorId })}
          style={pageBox(handle.rect)}
        />
      ))}
      {connectorDrag ? (
        <svg
          className="scene-connector-drag"
          data-testid="scene-connector-drag"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            overflow: "visible",
          }}
        >
          <path
            d={`M ${connectorDrag.from.x} ${connectorDrag.from.y} L ${connectorDrag.to.x} ${connectorDrag.to.y}`}
            strokeWidth={1.5 * sceneChromeScale(scene.camera.zoom)}
          />
        </svg>
      ) : null}
      {handles.map((entry) => (
        <span
          key={entry.key}
          className="scene-selection__handle"
          data-testid="scene-resize-handle"
          data-handle={entry.handle}
          data-lod={entry.lod}
          style={{ ...pageBox(entry.rect), cursor: resizeHandleCursor(entry.handle) }}
        />
      ))}
      {marquee ? (
        <div className="scene-marquee" data-testid="scene-marquee" style={pageBox(marquee)} />
      ) : null}
    </div>
  );
}

/**
 * Peer presence over the projection: a ring around every instance of a card a
 * peer selected, a dashed ghost where a peer's drag or resize is landing, and a
 * dot for each pointer in page space. Chips are counter-scaled through
 * `--scene-chrome-scale`, the same variable the local selection chrome uses.
 */
function PeerPresenceOverlay({
  scene,
  peers,
  rectFor,
  liveCards,
}: {
  scene: Scene;
  peers: readonly PeerPresence[];
  rectFor: (instanceKey: string, rect: Rect) => Rect;
  liveCards: boolean;
}) {
  const outlines = useMemo(
    () => peerSelectionOutlines(scene, peers, rectFor),
    [scene, peers, rectFor],
  );
  const ghosts = useMemo(() => peerGhosts(scene, peers), [scene, peers]);
  const dots = useMemo(() => peerPointerDots(scene, peers), [scene, peers]);
  // A live card mounts the real NodeCard, which already labels the gesture; the
  // ghost outline stays so far-LOD copies of the same gesture are visible too.
  const liveKeys = useMemo(() => {
    if (!liveCards) return null;
    const keys = new Set<string>();
    for (const card of scene.cards) {
      if (card.lod === "full" && card.portalKey === null) keys.add(card.key);
    }
    return keys;
  }, [liveCards, scene]);

  if (outlines.length === 0 && ghosts.length === 0 && dots.length === 0) return null;

  return (
    <div className="scene-peers" data-testid="scene-peers" aria-hidden="true">
      {outlines.map((outline) => (
        <div
          key={`selection-${outline.peer.clientId}-${outline.instanceKey}`}
          className="scene-peer-selection"
          data-testid="scene-peer-selection"
          data-peer-name={outline.peer.user.name}
          {...(outline.cardId ? { "data-card-id": outline.cardId } : {})}
          {...(outline.sectionId ? { "data-section-id": outline.sectionId } : {})}
          style={{
            ...pageBox(outline.rect),
            borderColor: outline.peer.user.color,
            boxShadow: `0 0 0 2px color-mix(in srgb, ${outline.peer.user.color} 26%, transparent)`,
          }}
        />
      ))}
      {ghosts.map((ghost) => (
        <div
          key={`ghost-${ghost.peer.clientId}-${ghost.kind}-${ghost.instanceKey}`}
          className="scene-peer-ghost"
          data-testid="scene-peer-ghost"
          data-kind={ghost.kind}
          data-peer-name={ghost.peer.user.name}
          style={{
            ...pageBox(ghost.rect),
            borderColor: ghost.peer.user.color,
            backgroundColor: `color-mix(in srgb, ${ghost.peer.user.color} 8%, transparent)`,
          }}
        >
          {ghost.anchor && !liveKeys?.has(ghost.instanceKey) ? (
            <span className="scene-peer-tag">
              <PeerNameTag user={ghost.peer.user} detail={ghost.detail} />
            </span>
          ) : null}
        </div>
      ))}
      {dots.map((dot) =>
        dot.clip ? (
          <div
            key={`pointer-${dot.peer.clientId}`}
            className="scene-peer-pointer"
            data-testid="scene-peer-pointer"
            data-peer-name={dot.peer.user.name}
            style={pageBox(dot.clip)}
          >
            <span
              className="scene-peer-pointer__dot"
              style={{
                left: dot.point.x - dot.clip.x,
                top: dot.point.y - dot.clip.y,
                backgroundColor: dot.peer.user.color,
              }}
            />
          </div>
        ) : (
          <span
            key={`pointer-${dot.peer.clientId}`}
            className="scene-peer-pointer__dot scene-peer-pointer__dot--free"
            data-testid="scene-peer-pointer"
            data-peer-name={dot.peer.user.name}
            style={{
              left: dot.point.x,
              top: dot.point.y,
              backgroundColor: dot.peer.user.color,
            }}
          />
        ),
      )}
    </div>
  );
}

/**
 * A DOM projection of a `@suite/scene` tree. Every box is in page
 * coordinates, so the layer can live inside React Flow's `ViewportPortal` and
 * pan/zoom with the camera; portals clip a recursive child board in place.
 */
export function SceneLayer({
  scene,
  viewport,
  cards,
  types,
  tags,
  miniatures,
  drawings,
  onFocusPortal,
  selectedIds = EMPTY_IDS,
  selectedSectionId = null,
  selectedEdgeIds = EMPTY_IDS,
  overrides = EMPTY_OVERRIDES,
  marquee = null,
  connectorHandles = EMPTY_HANDLES,
  connectorDrag = null,
  canEditLayout = false,
  liveCards = false,
  peers = EMPTY_PEERS,
}: SceneLayerProps) {
  const content = useMemo(() => indexScene(scene), [scene]);
  const boards = useMemo(() => new Map(scene.boards.map((board) => [board.key, board])), [scene]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEdges = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);
  const culling = viewport.width > 0 && viewport.height > 0;
  const rectFor = useCallback(
    (instanceKey: string, rect: Rect) => overrides.get(instanceKey) ?? rect,
    [overrides],
  );
  const context: SceneLayerContext = {
    content,
    boards,
    cards,
    types,
    tags,
    miniatures,
    drawings,
    onFocusPortal,
    viewport,
    culling,
    rectFor,
    selected,
    selectedEdges,
    selectedSectionId,
    liveCards,
  };

  return (
    <div
      className="scene-layer"
      data-testid="scene-layer"
      role="img"
      aria-label={`Scene: ${scene.counts.boards} boards, ${scene.counts.cards} cards, ${scene.counts.portals} portals`}
      style={{ "--scene-chrome-scale": sceneChromeScale(scene.camera.zoom) } as CSSProperties}
    >
      <BoardView context={context} board={scene.root} origin={ORIGIN} />
      <SelectionOverlay
        scene={scene}
        context={context}
        selectedIds={selectedIds}
        selectedSectionId={selectedSectionId}
        marquee={marquee}
        canEditLayout={canEditLayout}
        connectorHandles={connectorHandles}
        connectorDrag={connectorDrag}
      />
      {peers.length > 0 ? (
        <PeerPresenceOverlay scene={scene} peers={peers} rectFor={rectFor} liveCards={liveCards} />
      ) : null}
    </div>
  );
}
