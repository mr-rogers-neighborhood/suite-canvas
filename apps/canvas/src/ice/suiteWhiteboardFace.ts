/**
 * What a whiteboard card says before it is opened (ADR-0043 §3).
 *
 * A whiteboard's whole content is a picture, so "draw the text, not the picture"
 * leaves it blank paper until someone double-clicks it — the one card whose face
 * is empty by construction. The decision is a cached texture: rasterise the
 * drawing's SVG preview into an `ImageBitmap` on settle and draw it as one
 * textured quad (`suite.whiteboard`).
 *
 * WHAT IS DEFERRED, AND WHY — the texture is not reachable in this engine
 * version, so this module draws the interim the ADR names: the stroke count, and
 * a compact sketch of the strokes' **extents**.
 *
 * - The paper pass has one text channel. `TextRaster.raster` takes a single
 *   `face` and a `HandLayout` with no per-glyph face, and `PaperPass` allocates
 *   `r8` ink pages (`INK_PAGE` 2048 × 4 layers for the *whole* desk, 16 MB), so
 *   there is no image channel to write a thumbnail into.
 * - The only per-object image door is `PhotoPass`'s pictures, and it belongs to
 *   the `photo` kind: a different object with its own layout law, its own lift,
 *   curl and shadow physics and its own material. A whiteboard is a sheet, and
 *   reusing the print kind for it would make one card kind wear another's
 *   geometry.
 * - `KindHost` has no door to pin a committed raster per entity.
 *   `DeskLayerHandle.pinAsset` does, but it is the *still* path (the oracle's
 *   parity scenes), is keyed by entity, and takes an asset in a shape the kind
 *   defines — it is not reachable from the projection's wiring, and the ink
 *   shelf is the sheet, not an image.
 *
 * So the interim is honest about being a stopgap: `✎ 42` is a count, and the
 * sketch below is **not a thumbnail**. It is the drawing's bounding boxes folded
 * into a small density grid of block characters — one character cell per slice
 * of the drawing, the character's height its share of the densest cell. It says
 * "there is a big thing on the left and a small one on the right"; it does not
 * say what they are, and no pixel of the scene is invented to make it look like
 * it does.
 *
 * Cost: the elements are read once per reconcile (`drawing(cardId)`), never per
 * frame, and the grid is 24 × 3 characters — the same one text flow the paper
 * already writes, so it costs no raster, no shelf carve and no texture.
 */

import type { DrawingElement } from "@suite/graph";

import { whiteboardPreview } from "../cards/whiteboardPreview";

/**
 * The sketch's width in characters: 24 fits the reference card's ~40-character
 * line with the title row's own room beside it.
 */
export const WHITEBOARD_SKETCH_COLUMNS = 24;

/** Three rows read as a picture; more would spend the body on the sketch. */
export const WHITEBOARD_SKETCH_ROWS = 3;

/**
 * The eight block heights, lowest first. Every cell is one of these — a blank
 * cell is the *lowest block*, not a space, so the columns stay a grid: the
 * desk's face is proportional, and a space between two blocks would shift every
 * column to its right.
 */
export const WHITEBOARD_SKETCH_LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** One whiteboard's face material: what it has drawn, and the sketch of it. */
export interface WhiteboardFace {
  /** Live strokes (tombstones excluded) — the count the title row prints. */
  readonly strokes: number;
  /**
   * The drawing's extents as block characters, top row first. Empty when the
   * drawing is empty: a sketch of nothing is not a sketch.
   */
  readonly sketch: readonly string[];
  /** Nothing has been drawn yet. */
  readonly empty: boolean;
}

/** An empty board: no strokes, no sketch line, and the title row says nothing extra. */
export const EMPTY_WHITEBOARD_FACE: WhiteboardFace = Object.freeze({
  strokes: 0,
  sketch: Object.freeze([]),
  empty: true,
});

/** Samples per cell side: 16 probes is a coverage figure a 24 × 3 grid can use. */
const SKETCH_SAMPLES = 4;

/**
 * The character a cell's coverage deserves: how much of the cell the strokes'
 * boxes fill, in eighths. A cell no box crosses is the faint baseline; a cell a
 * box barely grazes is still marked, because a hairline is an extent too.
 */
function levelOf(coverage: number, touches: boolean): string {
  if (!touches) return WHITEBOARD_SKETCH_LEVELS[0];
  const highest = WHITEBOARD_SKETCH_LEVELS.length - 1;
  const share = Math.round(highest * Math.min(1, Math.max(0, coverage)));
  const index = Math.min(highest, Math.max(1, share));
  return WHITEBOARD_SKETCH_LEVELS[index] ?? WHITEBOARD_SKETCH_LEVELS[0];
}

/**
 * The drawing's extents on a `columns × rows` grid, as block characters.
 *
 * A cell counts a stroke when the stroke's **box** overlaps it — extents, not
 * paths: nothing here reads a point list, invents a smoothing or pretends to
 * know what a stroke draws. The tallest character marks the cell the most boxes
 * cross; the faintest baseline marks a cell none does.
 */
export function whiteboardSketch(
  elements: readonly DrawingElement[],
  columns: number = WHITEBOARD_SKETCH_COLUMNS,
  rows: number = WHITEBOARD_SKETCH_ROWS,
): string[] {
  const preview = whiteboardPreview(elements);
  if (preview.empty) return [];
  const width = columns > 0 ? Math.floor(columns) : WHITEBOARD_SKETCH_COLUMNS;
  const height = rows > 0 ? Math.floor(rows) : WHITEBOARD_SKETCH_ROWS;
  const { viewBox } = preview;
  const cellWidth = Math.max(viewBox.width, 1) / width;
  const cellHeight = Math.max(viewBox.height, 1) / height;

  const lines: string[] = [];
  for (let row = 0; row < height; row += 1) {
    const y0 = row * cellHeight;
    const y1 = y0 + cellHeight;
    let line = "";
    for (let column = 0; column < width; column += 1) {
      const x0 = column * cellWidth;
      const x1 = x0 + cellWidth;
      let touches = false;
      let inside = 0;
      for (let sy = 0; sy < SKETCH_SAMPLES; sy += 1) {
        const y = y0 + ((sy + 0.5) / SKETCH_SAMPLES) * cellHeight;
        for (let sx = 0; sx < SKETCH_SAMPLES; sx += 1) {
          const x = x0 + ((sx + 0.5) / SKETCH_SAMPLES) * cellWidth;
          for (const shape of preview.shapes) {
            if (x <= shape.x || x >= shape.x + shape.width) continue;
            if (y <= shape.y || y >= shape.y + shape.height) continue;
            touches = true;
            inside += 1;
            break;
          }
        }
      }
      if (!touches) {
        // A shape can be thinner than a sample (a rule, a hairline arrow): if its
        // box crosses the cell at all, the cell is drawn, faintly — an extent
        // that fits between two samples is still an extent.
        touches = preview.shapes.some(
          (shape) =>
            shape.x < x1 &&
            shape.x + shape.width > x0 &&
            shape.y < y1 &&
            shape.y + shape.height > y0,
        );
      }
      const coverage = inside / (SKETCH_SAMPLES * SKETCH_SAMPLES);
      line += levelOf(coverage, touches);
    }
    lines.push(line);
  }
  return lines;
}

/** What a whiteboard's face is made of, from its scene. Never invents strokes. */
export function whiteboardFace(
  elements: readonly DrawingElement[] | null | undefined,
): WhiteboardFace {
  const live = (elements ?? []).filter((element) => element.deletedAt === undefined);
  if (live.length === 0) return EMPTY_WHITEBOARD_FACE;
  return { strokes: live.length, sketch: whiteboardSketch(live), empty: false };
}

/** The sketch as the one body line the flow carries — lines joined by newlines. */
export function whiteboardSketchBody(face: WhiteboardFace): string {
  return face.sketch.join("\n");
}
