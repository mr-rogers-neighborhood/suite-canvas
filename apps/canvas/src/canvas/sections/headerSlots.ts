/**
 * Where each section's header sits, once the ones in front of it have taken their room.
 *
 * A section's pill is anchored to its frame's top-left corner, and a section nested in another
 * usually shares that corner, so the child's pill landed exactly on the parent's: the parent looked
 * selected, unselected or simply absent depending on paint order, and the one underneath could not be
 * pressed at all. Stacking the colliding pill downward keeps both reachable, which is the whole job.
 *
 * The pill is counter-scaled (`1/zoom`) so it stays readable, so its size on the screen is constant
 * while its size in flow units is not. Placement therefore happens in screen pixels and comes back in
 * flow coordinates, which is why `zoom` is an input rather than something the caller applies.
 *
 * Pure: no DOM, no measurement, no store. Titles are estimated rather than measured so the same board
 * resolves the same way on every client, and the estimate is deliberately generous — two pills that
 * overlap by a few pixels are worse than one that dodged when it did not strictly have to.
 */

/** The painted pill's height, in screen pixels; matches `.section-header` in `global.css`. */
export const HEADER_HEIGHT = 24;
/** Between two stacked pills. */
export const HEADER_GAP = 4;
/** How far a pill sits inside its frame's corner, in screen pixels. */
const HEADER_INSET_X = 8;
const HEADER_INSET_Y = 6;
/**
 * The widest a pill gets: `.section-title` caps at 220px, plus the dot, the count, the gaps and the
 * padding. A title longer than the cap cannot widen the box past this.
 */
const HEADER_MAX_WIDTH = 260;
/** Past this many steps the dodge is no longer a dodge; the pill stays where the last step put it. */
const MAX_DODGE_STEPS = 4;

/**
 * One frame as it is being painted: the stored rect with any live drag, resize or fold applied.
 *
 * The pill follows the frame, so a slot computed from the stored geometry would leave the header
 * behind every time a section was dragged.
 */
export interface HeaderFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A slot in flow coordinates: where the pill's top-left corner goes. */
export interface HeaderSlot {
  x: number;
  y: number;
}

/** The screen-space box a slot occupies at a scale, used only inside this module. */
interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The header slot for every section, in flow coordinates.
 *
 * Largest first, so a frame claims its own corner and the frames inside it dodge: the alternative
 * moves the parent every time a child is added, which is a layout the reader did not ask for.
 */
export function headerSlots(frames: readonly HeaderFrame[], zoom: number): Map<string, HeaderSlot> {
  const slots = new Map<string, HeaderSlot>();
  if (frames.length === 0) return slots;

  // A bad scale reads as 1, the same way `zoomBand` treats a failed measurement: a pill may then be
  // placed imperfectly, and it is still placed.
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const step = (HEADER_HEIGHT + HEADER_GAP) / scale;
  const insetX = HEADER_INSET_X / scale;
  const insetY = HEADER_INSET_Y / scale;
  const width = HEADER_MAX_WIDTH / scale;
  const height = HEADER_HEIGHT / scale;

  const ordered = [...frames].sort(
    (a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id),
  );
  const taken: ScreenBox[] = [];

  for (const frame of ordered) {
    const left = frame.x + insetX;
    const top = frame.y + insetY;
    let candidate = { left, top };

    for (let attempt = 0; attempt <= MAX_DODGE_STEPS; attempt += 1) {
      const box: ScreenBox = {
        left: candidate.left,
        top: candidate.top,
        right: candidate.left + width,
        bottom: candidate.top + height,
      };
      if (!taken.some((placed) => overlaps(placed, box))) {
        taken.push(box);
        slots.set(frame.id, { x: candidate.left, y: candidate.top });
        break;
      }
      candidate = { left, top: top + step * (attempt + 1) };
    }

    // Out of steps: the last candidate is as good as it gets, and leaving the section without a slot
    // would put its pill back under the one it was dodging.
    if (!slots.has(frame.id)) {
      slots.set(frame.id, { x: candidate.left, y: candidate.top });
    }
  }

  return slots;
}
