import type { CanvasMode } from "../canvas/links/linkGesture";
import type { CanvasPurpose } from "../canvas/purpose";
import type { PresenceUser } from "../collab/presence";
import { presenceChipInk } from "../presence/PeerNameTag";

/**
 * The status cursor (ADR-0064).
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
  fan: "\u273b",
};

/**
 * The purpose's own glyph, on the ring. `explore` has none: a plain canvas is the
 * absence of a state, and an arrow that announces "nothing" is noise.
 */
export const PURPOSE_GLYPHS: Record<CanvasPurpose, string | null> = {
  explore: null,
  // A queue, not a play triangle: `run` places a list, it does not play anything
  // back (ADR-0064 §11).
  run: "\u2261",
  explain: "\u25c8",
  record: "\u25c9",
  present: "\u25a3",
};

/** How the ring is drawn, independent of its colour. */
export type RingShape = "solid" | "double" | "dashed" | "halo";

export const RING_SHAPES: Record<CanvasPurpose, RingShape> = {
  explore: "solid",
  run: "double",
  // Solid, like exploring: explain is a way of *looking*, and the ring's shape has to
  // stay free to mark the states that change what a click will write.
  explain: "solid",
  record: "dashed",
  present: "halo",
};

const PURPOSE_LABELS: Record<CanvasPurpose, string> = {
  explore: "exploring",
  run: "running a sequence",
  explain: "gathering a context",
  record: "recording a tour",
  present: "presenting",
};

export interface StatusCursorProps {
  user: PresenceUser;
  purpose: CanvasPurpose;
  gesture: CanvasMode;
  /**
   * True only if a cursor ever speaks for the reader again. The local bubble is
   * withdrawn (ADR-0064 amendment), so the layer always passes `false`; the flag is
   * kept because it decides whether the bubble is in the reader's tab order, which is
   * the right answer for a cursor that is not theirs.
   */
  isSelf: boolean;
}

function initialOf(user: PresenceUser): string {
  return user.name.charAt(0).toUpperCase();
}

/**
 * Everything the cursor knows, in one sentence. A pointer that is only a colour would
 * be a state some readers cannot read, so the label is not decoration.
 *
 * A peer cursor carries two things now: who they are, and what the next click will do.
 * A run count, the unread count and the stack of off-screen people used to ride here
 * too; all three spoke for the reader's own pointer, and the bar, the dock and the
 * edge ticks answer them without a bubble.
 */
function cursorLabel(user: PresenceUser, purpose: CanvasPurpose, gesture: CanvasMode): string {
  const parts = [`${user.name} \u2014 ${PURPOSE_LABELS[purpose]}`];
  if (gesture !== "place") parts.push(gesture);
  return parts.join(" \u00b7 ");
}

export function StatusCursor({ user, purpose, gesture, isSelf }: StatusCursorProps) {
  const label = cursorLabel(user, purpose, gesture);
  const glyph = PURPOSE_GLYPHS[purpose];

  return (
    <div
      className="status-cursor"
      data-testid="status-cursor"
      data-purpose={purpose}
      data-gesture={gesture}
      // `data-mode` is what the palette reads, so a peer's gesture glyph is the same
      // colour as the widget its owner is using (ADR-0064 fifth amendment).
      data-mode={gesture}
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
      {/* A peer's next click is the one thing their bubble cannot imply from the ring
          alone, so it keeps a slot. Run progress, unread and the stack of off-screen
          people are gone with the local bubble: the bar, the dock and the edge ticks
          say those without a bubble. */}
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
      </span>
    </div>
  );
}
