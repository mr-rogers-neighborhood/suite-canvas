import { useRef } from "react";
import type { PresenceUser } from "../collab/presence";
import { PresenceAvatars } from "../components/PresenceAvatars";
import { BoardMiniature } from "./BoardMiniature";
import type { BoardMiniatureModel, MiniatureDot } from "./portalMiniature";

/** Fallback frame for a portal that has never been resized, or whose board is empty. */
export const DEFAULT_PORTAL_SIZE = { width: 288, height: 256 } as const;
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
  /** Peers whose active board is the target, shown on the card and in its title. */
  peers?: readonly PresenceUser[];
  selected?: boolean;
  width?: number | null;
  height?: number | null;
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
  peers = [],
  selected = false,
  width,
  height,
  onOpen,
  onOpenInfo,
}: PortalCardProps) {
  const names = peers.map((peer) => peer.name).join(", ");
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const unavailable = boardName === null;
  const count = model.cardCount;

  return (
    // A canvas node keeps its double-click gesture and its selection click, so
    // the semantic element here is a div with the button role, not a real button.
    // biome-ignore lint/a11y/useSemanticElements: a <button> would open on a single click, which must still select the node.
    <div
      data-testid="portal-node"
      data-unavailable={unavailable ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      role="button"
      tabIndex={0}
      // The accessible name is the card's own content, prefixed by this hidden
      // word, so it always contains the text a sighted reader sees.
      aria-disabled={unavailable ? "true" : undefined}
      className={`portal-card node-card${selected ? " is-selected" : ""}${
        unavailable ? " is-unavailable" : ""
      }`}
      style={{
        width: width ?? DEFAULT_PORTAL_SIZE.width,
        height: height ?? DEFAULT_PORTAL_SIZE.height,
      }}
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
          <p className="portal-card__missing" data-testid="portal-unavailable">
            Unavailable board
          </p>
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
