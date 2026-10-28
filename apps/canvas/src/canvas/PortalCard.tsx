import type { StyleShape, SurfaceStyle } from "@suite/graph";
import { resolveSurfaceStyle } from "@suite/graph";
import { type CSSProperties, useRef } from "react";
import type { PresenceUser } from "../collab/presence";
import { PresenceAvatars } from "../presence/PresenceAvatars";
import { BoardMiniature } from "./BoardMiniature";
import type { BoardMiniatureModel, MiniatureDot } from "./portalMiniature";
import { isShapedSurface, shapeInset, surfacePaintVars } from "./surfacePaint";

/** Fallback frame for a portal that has never been resized, or whose board is empty. */
export const DEFAULT_PORTAL_SIZE = { width: 288, height: 256 } as const;

/** The paint record as a DOM style: a custom property needs its `--` prefix. */
function paintStyle(paint: Record<string, string>): CSSProperties {
  return paint as CSSProperties;
}
/** Longest side of a new portal's frame, and the clamps on the shorter one. */
const PORTAL_LONG_SIDE = 300;
const PORTAL_MIN_SIDE = 168;
const PORTAL_MAX_SIDE = 340;

/**
 * A new portal is shaped like the board it opens, so its miniature reads as a
 * scaled picture of that board instead of a drawing floating in a mismatched
 * frame. An empty or missing board gets the neutral square default.
 */
export function portalSizeForBounds(bounds: { width: number; height: number } | null): {
  width: number;
  height: number;
} {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { ...DEFAULT_PORTAL_SIZE };
  const ratio = bounds.width / bounds.height;
  const clamp = (value: number) => Math.min(PORTAL_MAX_SIDE, Math.max(PORTAL_MIN_SIDE, value));
  if (ratio >= 1) {
    return { width: PORTAL_LONG_SIDE, height: clamp(PORTAL_LONG_SIDE / ratio) };
  }
  return { width: clamp(PORTAL_LONG_SIDE * ratio), height: PORTAL_LONG_SIDE };
}

export interface PortalCardProps {
  /** Target board's name, or null when the stored id no longer resolves. */
  boardName: string | null;
  /** Type glyph; the seeded portal type uses a circled dot. */
  glyph: string;
  model: BoardMiniatureModel;
  dots?: readonly MiniatureDot[];
  /** A chosen cover image; it stands in for the live picture while it resolves. */
  cover?: string | null;
  /** Peers whose active board is the target, shown on the card and in its title. */
  peers?: readonly PresenceUser[];
  selected?: boolean;
  width?: number | null;
  height?: number | null;
  /** The portal card's own paint; absent renders today's chrome unchanged. */
  style?: SurfaceStyle | undefined;
  /** Double-click or Enter: the canvas plays the camera transition. */
  onOpen?: (() => void) | undefined;
  /** A click anywhere on the card: read the portal in the container panel. */
  onOpenInfo?: (() => void) | undefined;
}

/**
 * The portal card itself. Presentation only: the board name, the miniature and
 * the peers all arrive as props, which is what makes the same card renderable
 * in Storybook without a document or a presence session.
 */
export function PortalCard({
  boardName,
  glyph,
  model,
  dots = [],
  cover = null,
  peers = [],
  selected = false,
  width,
  height,
  style,
  onOpen,
  onOpenInfo,
}: PortalCardProps) {
  const names = peers.map((peer) => peer.name).join(", ");
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const unavailable = boardName === null;
  const count = model.cardCount;

  // A portal is a card, so it paints from the same record and the same rules;
  // the root's `node-card` class is what lets the card paint CSS apply at all.
  const paint = style ? surfacePaintVars(resolveSurfaceStyle(style, "card")) : {};
  const painted = Object.keys(paint).length > 0;
  const seamless = style?.surface === "none";
  // A portal wears a silhouette the same way a note does: the frame, the shadow and the
  // selection ring are rectangles, so the shape is the outline and they stand down.
  const paintedShape = paint["--paint-shape"] as StyleShape | undefined;
  const shape = isShapedSurface(paintedShape) ? paintedShape : null;
  const inset = shapeInset(shape, {
    width: width ?? DEFAULT_PORTAL_SIZE.width,
    height: height ?? DEFAULT_PORTAL_SIZE.height,
  });

  return (
    // A canvas node keeps its double-click gesture and its selection click, so
    // the semantic element here is a div with the button role, not a real button.
    // biome-ignore lint/a11y/useSemanticElements: a <button> would open on a single click, which must still select the node.
    <div
      data-testid="portal-node"
      data-unavailable={unavailable ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-seamless={seamless ? "true" : undefined}
      data-shape={shape ?? undefined}
      role="button"
      tabIndex={0}
      // The accessible name is the card's own content, prefixed by this hidden
      // word, so it always contains the text a sighted reader sees.
      aria-disabled={unavailable ? "true" : undefined}
      className={`portal-card node-card${selected ? " is-selected" : ""}${
        unavailable ? " is-unavailable" : ""
      }${painted ? " is-painted" : ""}`}
      style={
        {
          ...paintStyle(paint),
          width: width ?? DEFAULT_PORTAL_SIZE.width,
          height: height ?? DEFAULT_PORTAL_SIZE.height,
          ...(shape
            ? {
                "--shape-inset-x": `${inset.x}px`,
                "--shape-inset-y": `${inset.y}px`,
                "--shape-title-inset-x": `${inset.titleX}px`,
              }
            : {}),
        } as CSSProperties
      }
      onPointerDown={(event) => {
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
      }}
      // A click reads the portal, a double click walks through it — the same split
      // a note has between its info click and its double click. Anywhere on the
      // card, not just the header: the miniature is what people aim at.
      onClick={(event) => {
        const origin = pointerOrigin.current;
        const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) : 0;
        // A drag moves the card; it does not also open a panel.
        if (moved > 4) return;
        // The second click of a double click is the doorway, not an inspection.
        if (event.detail > 1) return;
        onOpenInfo?.();
      }}
      onDoubleClick={(event) => {
        if (unavailable) return;
        event.preventDefault();
        onOpen?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (unavailable) return;
        event.preventDefault();
        event.stopPropagation();
        onOpen?.();
      }}
    >
      <span className="sr-only">Portal to </span>
      <header className="portal-card__header">
        <span aria-hidden="true" className="portal-card__glyph">
          {glyph}
        </span>
        <span className="portal-card__title" title={boardName ?? "Unavailable board"}>
          {boardName ?? "Unavailable board"}
        </span>
        <PresenceAvatars users={[...peers]} max={3} />
      </header>

      {/* The frame takes the target board's shape, so the drawing fills it rather
          than letterboxing inside a box chosen for its own sake. */}
      <div
        className="portal-card__frame"
        style={{
          aspectRatio: `${model.viewBox.width} / ${model.viewBox.height}`,
        }}
      >
        {unavailable ? (
          // A missing target is a state, not a broken drawing: the frame keeps
          // the card's shape, turns dashed, and says what happened.
          <div
            className="portal-card__missing"
            data-testid="portal-unavailable"
            style={{
              flexDirection: "column",
              gap: 4,
              padding: "0 14px",
              border: "1px dashed color-mix(in srgb, var(--ink-muted) 55%, transparent)",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <span>Unavailable board</span>
            <span style={{ fontStyle: "normal", fontSize: 10 }}>
              The board this portal opened was removed.
            </span>
          </div>
        ) : cover ? (
          // A cover is a still picture of the board the way its author chose to
          // show it; the miniature would cost a redraw of somebody else's board.
          <img src={cover} alt={`${boardName} cover`} className="portal-cover" />
        ) : (
          <BoardMiniature model={model} dots={dots} label={`${boardName} miniature`} />
        )}
        {boardName !== null && count === 0 ? (
          <span className="portal-card__empty">Empty board</span>
        ) : null}
      </div>

      <footer className="portal-card__footer">
        {unavailable ? null : (
          <span data-testid="portal-card-count" className="portal-card__count">
            {count} card{count === 1 ? "" : "s"}
          </span>
        )}
        {peers.length > 0 ? (
          <span
            data-testid="portal-presence"
            className="portal-card__peers"
            role="img"
            aria-label={`Here now: ${names}`}
            title={names}
          >
            {peers.map((peer) => (
              <span
                key={`${peer.name}:${peer.color}`}
                aria-hidden="true"
                className="portal-card__peer-dot"
                style={{ backgroundColor: peer.color }}
              />
            ))}
          </span>
        ) : null}
      </footer>
    </div>
  );
}
