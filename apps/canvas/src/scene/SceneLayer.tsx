import type { Card, CardType, Drawing, EdgePath, Tag } from "@suite/graph";
import {
  type BoardInstance,
  boardInstanceKey,
  type CardInstance,
  type EdgeInstance,
  type Point,
  type PortalInstance,
  type Rect,
  rectIntersects,
  type Scene,
  type SectionInstance,
} from "@suite/scene";
import { type CSSProperties, useMemo } from "react";
import { BoardMiniature } from "../canvas/BoardMiniature";
import type { BoardMiniatureModel } from "../canvas/portalMiniature";
import { cardMeta } from "../cards/cardMeta";
import { FALLBACK_CARD_TYPE, resolveCardType } from "../cards/cardTypes";
import { WhiteboardPreview } from "../cards/WhiteboardPreview";
import { isWhiteboardCard } from "../cards/whiteboard";
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
  viewport: Rect;
  culling: boolean;
}

const ORIGIN: Point = { x: 0, y: 0 };
const EMPTY_META = { properties: [], tags: [] } as const;

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

function EdgeLayer({
  edges,
  origin,
  strokeWidth,
}: {
  edges: readonly EdgeInstance[];
  origin: Point;
  strokeWidth: number;
}) {
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
      {edges.map((edge) => (
        <path
          key={edge.key}
          className="scene-edge"
          data-edge-id={edge.edgeId}
          d={edgePath(
            { x: edge.from.x - origin.x, y: edge.from.y - origin.y },
            { x: edge.to.x - origin.x, y: edge.to.y - origin.y },
            edge.route,
          )}
          strokeWidth={strokeWidth}
        />
      ))}
    </svg>
  );
}

function SectionView({
  section,
  origin,
  scale,
}: {
  section: SectionInstance;
  origin: Point;
  scale: number;
}) {
  const color = section.color ?? "slate";
  return (
    <div
      className="scene-section"
      data-testid="scene-section"
      data-section-id={section.sectionId}
      data-lod={section.lod}
      style={
        {
          ...translated(section.rect, origin, 11 * scale),
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
  const meta =
    model && context.types && context.tags
      ? cardMeta(model, context.types, context.tags, 3)
      : EMPTY_META;
  const title = card.title ?? "Untitled";
  const drawing = context.drawings?.get(card.cardId);

  if (card.lod === "full") {
    return (
      <div
        className="scene-card scene-card--full"
        data-testid="scene-card"
        data-card-id={card.cardId}
        data-lod={card.lod}
        style={{ ...translated(card.rect, origin, 13 * scale), zIndex: 2000 + Math.round(card.z) }}
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
        style={{ ...translated(card.rect, origin, 12 * scale), zIndex: 2000 + Math.round(card.z) }}
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
        style={{ ...translated(card.rect, origin, 18 * scale), zIndex: 2000 + Math.round(card.z) }}
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
  const board = portal.childKey ? context.boards.get(portal.childKey) : undefined;
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
        style={{ ...translated(portal.frame, origin, 12 * scale), zIndex: 2000 + cardZ }}
      >
        <div className="scene-portal__clip" data-testid="scene-portal-child">
          <BoardView context={context} board={board} origin={portal.frame} />
        </div>
        <div className="scene-portal__header scene-portal__header--live">
          <span className="scene-portal__glyph" aria-hidden="true">
            {"\u25c9"}
          </span>
          <span className="scene-portal__title">{portal.title ?? board.name}</span>
          <span className="scene-portal__status">Live</span>
        </div>
      </div>
    );
  }

  return (
    <div
      {...common}
      className="scene-portal scene-portal--impostor"
      style={{ ...translated(portal.frame, origin, 12 * scale), zIndex: 2000 + cardZ }}
    >
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
    (card) => card.portalKey === null && card.lod !== "hidden" && isShown(context, card.rect),
  );
  const sections = content.sections.filter(
    (section) => section.lod !== "hidden" && isShown(context, section.rect),
  );
  const edges = content.edges.filter(
    (edge) => edge.lod !== "hidden" && isShown(context, edge.bounds),
  );
  const portals = content.portals.filter(
    (portal) => portal.lod !== "hidden" && isShown(context, portal.frame),
  );

  return (
    <div
      className="scene-board-content"
      data-board-key={board.key}
      data-board-id={board.boardId}
      data-lod={board.lod}
    >
      {sections.map((section) => (
        <SectionView key={section.key} section={section} origin={origin} scale={scale} />
      ))}
      {edges.length > 0 ? (
        <EdgeLayer edges={edges} origin={origin} strokeWidth={Math.max(0.5, 1.4 * scale)} />
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

/**
 * A read-only DOM projection of a `@suite/scene` tree. Every box is in page
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
}: SceneLayerProps) {
  const content = useMemo(() => indexScene(scene), [scene]);
  const boards = useMemo(() => new Map(scene.boards.map((board) => [board.key, board])), [scene]);
  const culling = viewport.width > 0 && viewport.height > 0;
  const context: SceneLayerContext = {
    content,
    boards,
    cards,
    types,
    tags,
    miniatures,
    drawings,
    viewport,
    culling,
  };

  return (
    <div
      className="scene-layer"
      data-testid="scene-layer"
      role="img"
      aria-label={`Scene preview: ${scene.counts.boards} boards, ${scene.counts.cards} cards, ${scene.counts.portals} portals`}
    >
      <BoardView context={context} board={scene.root} origin={ORIGIN} />
    </div>
  );
}
