import type { PresenceUser } from "../collab/presence";
import { PresenceAvatars } from "../components/PresenceAvatars";
import { BoardMiniature } from "./BoardMiniature";
import type { BoardMiniatureModel, MiniatureDot } from "./portalMiniature";

/** Fallback frame for a portal that has never been resized. */
export const DEFAULT_PORTAL_SIZE = { width: 288, height: 208 } as const;

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
}: PortalCardProps) {
  const names = peers.map((peer) => peer.name).join(", ");
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

      <div className="portal-card__frame">
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
