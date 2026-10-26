import type { CanvasMode } from "../canvas/linkGesture";
import type { CanvasPurpose } from "../canvas/purpose";
import type { PresenceUser } from "../collab/presence";
import { presenceChipInk } from "../components/PeerNameTag";

/**
 * The status cursor ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)).
 *
 * One renderer for the reader's pointer and for every peer's: a bubble with a
 * corner pointer so it reads as a cursor rather than an avatar, a ring whose
 * colour *and shape* carry the purpose, and a fixed order of optional slots. The
 * shapes are the point — a ring that differs only in hue is unreadable to a
 * colour-blind reader and in a monochrome screenshot, so every purpose also has
 * a glyph and is named in the bubble's label.
 */

/** The glyph a gesture carries in its slot. `place` has one but never shows it. */
export const GESTURE_GLYPHS: Record<CanvasMode, string> = {
  place: "\u2194",
  thread: "\u2933",
  web: "\u273b",
  pattern: "\u22b9",
};

/**
 * The purpose's own glyph, on the ring. `explore` has none: a plain canvas is the
 * absence of a state, and an arrow that announces "nothing" is noise.
 */
export const PURPOSE_GLYPHS: Record<CanvasPurpose, string | null> = {
  explore: null,
  run: "\u25b8",
  record: "\u25c9",
  present: "\u25a3",
};

/** How the ring is drawn, independent of its colour. */
export type RingShape = "solid" | "double" | "dashed" | "halo";

export const RING_SHAPES: Record<CanvasPurpose, RingShape> = {
  explore: "solid",
  run: "double",
  record: "dashed",
  present: "halo",
};

const PURPOSE_LABELS: Record<CanvasPurpose, string> = {
  explore: "exploring",
  run: "running a sequence",
  record: "recording a tour",
  present: "presenting",
};

export interface RunProgress {
  placed: number;
  total: number;
}

export interface StatusCursorProps {
  user: PresenceUser;
  purpose: CanvasPurpose;
  gesture: CanvasMode;
  /** A live run's count; absent when no run is in flight. */
  runProgress?: RunProgress | null;
  /** Unread chat count; `0` (or absent) removes the slot. */
  unread?: number;
  /** Peers whose cursors are outside the viewport, for the collapsed stack. */
  peers?: PresenceUser[];
  /** True for the reader's own cursor, false for a peer's. */
  isSelf: boolean;
  /** Bring the off-screen peers into view. */
  onPeersClick?: (() => void) | undefined;
}

function initialOf(user: PresenceUser): string {
  return user.name.charAt(0).toUpperCase();
}

function peerTitle(count: number): string {
  return `${count} ${count === 1 ? "cursor" : "cursors"} outside this view`;
}

/**
 * Everything the cursor knows, in one sentence. A pointer that is only a colour
 * would be a state some readers cannot read, so the label is not decoration.
 */
interface CursorLabelInput {
  user: PresenceUser;
  purpose: CanvasPurpose;
  gesture: CanvasMode;
  runProgress: RunProgress | null;
  unread: number;
  peers: PresenceUser[];
}

function cursorLabel({
  user,
  purpose,
  gesture,
  runProgress,
  unread,
  peers,
}: CursorLabelInput): string {
  const parts = [`${user.name} \u2014 ${PURPOSE_LABELS[purpose]}`];
  if (gesture !== "place") parts.push(gesture);
  if (runProgress) parts.push(`${runProgress.placed} of ${runProgress.total} placed`);
  if (unread > 0) parts.push(`${unread} unread`);
  if (peers.length > 0) parts.push(peerTitle(peers.length));
  return parts.join(" \u00b7 ");
}

/** One avatar per identity: two peers can share a generated name and colour. */
function uniquePeers(peers: PresenceUser[]): PresenceUser[] {
  return peers.filter(
    (peer, index) =>
      peers.findIndex((other) => other.name === peer.name && other.color === peer.color) === index,
  );
}

export function StatusCursor({
  user,
  purpose,
  gesture,
  runProgress = null,
  unread = 0,
  peers = [],
  isSelf,
  onPeersClick,
}: StatusCursorProps) {
  const label = cursorLabel({ user, purpose, gesture, runProgress, unread, peers });
  // Four slots is the ceiling (ADR-0064); the stack shows three dots and a count.
  const stack = uniquePeers(peers).slice(0, 3);
  const glyph = PURPOSE_GLYPHS[purpose];

  return (
    <div
      className="status-cursor"
      data-testid="status-cursor"
      data-purpose={purpose}
      data-gesture={gesture}
      data-self={isSelf ? "true" : "false"}
      // The corner pointer inherits the owner's presence colour from here, so the
      // pointer and the bubble cannot drift apart.
      style={{ color: user.color }}
    >
      {/* The corner pointer is what makes the bubble a cursor: its tip is the
          actual pointer position, and the bubble hangs below-right of it. */}
      <span className="status-cursor__pointer" aria-hidden="true" />
      <div className="status-cursor__body">
        <span
          className={`status-cursor__ring status-cursor__ring--${purpose}`}
          data-testid="status-cursor-ring"
          data-purpose={purpose}
          data-shape={RING_SHAPES[purpose]}
          aria-hidden="true"
        />
        {glyph ? (
          <span
            className="status-cursor__purpose"
            data-testid="status-cursor-purpose"
            aria-hidden="true"
          >
            {glyph}
          </span>
        ) : null}
        {/* A button so it can be reached from the keyboard; a peer's cursor is out
            of the reader's tab order because it is not their pointer. */}
        <button
          type="button"
          className="status-cursor__bubble"
          data-testid="status-cursor-bubble"
          title={label}
          aria-label={label}
          tabIndex={isSelf ? 0 : -1}
          style={{ backgroundColor: user.color, color: presenceChipInk(user.color) }}
        >
          <span aria-hidden="true">{initialOf(user)}</span>
        </button>
      </div>
      <span className="status-cursor__slots">
        {gesture !== "place" ? (
          <span
            className="status-cursor__slot status-cursor__slot--gesture"
            data-slot="gesture"
            data-testid="status-cursor-gesture"
            title={`Next click: ${gesture}`}
          >
            {GESTURE_GLYPHS[gesture]}
          </span>
        ) : null}
        {runProgress ? (
          <span
            className="status-cursor__slot status-cursor__slot--run"
            data-slot="run"
            data-testid="status-cursor-run"
            title={`${runProgress.placed} of ${runProgress.total} placed`}
          >
            {`${runProgress.placed}/${runProgress.total}`}
          </span>
        ) : null}
        {unread > 0 ? (
          <span
            className="status-cursor__slot status-cursor__slot--unread"
            data-slot="unread"
            data-testid="status-cursor-unread"
            title={`${unread} unread ${unread === 1 ? "message" : "messages"}`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
        {peers.length > 0 ? (
          <button
            type="button"
            className="status-cursor__peers"
            data-slot="peers"
            data-testid="status-cursor-peers"
            title={peerTitle(peers.length)}
            aria-label={peerTitle(peers.length)}
            onClick={onPeersClick}
          >
            {stack.map((peer) => (
              <span
                key={`${peer.name}:${peer.color}`}
                className="status-cursor__peer"
                style={{ backgroundColor: peer.color }}
                aria-hidden="true"
              />
            ))}
            {peers.length > stack.length ? (
              <span className="status-cursor__peer-more" aria-hidden="true">
                {`+${peers.length - stack.length}`}
              </span>
            ) : null}
          </button>
        ) : null}
      </span>
    </div>
  );
}
