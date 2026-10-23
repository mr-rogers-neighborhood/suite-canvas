/**
 * The 2.5D of the type graph: depth, projected onto the screen, never authored.
 *
 * A graph node's `depth` is *derived* (`packages/scene/src/typeGraph.ts`: portal
 * depth plus how many sections contain its container). Nothing stores a Z, and
 * there is no perspective camera: ICE owns the one camera and this surface never
 * opens a second one (ADR-0034). What "deeper" means is therefore a *drawing*
 * rule, and it is the cheapest one that reads: a deeper node's face sits a few
 * pixels up and left of its footprint, slightly smaller, over a deeper shadow —
 * a stack of plates, the way a pile of papers implies height without a horizon.
 *
 * The numbers are CSS pixels and scale factors, not world units, because the
 * faces they decorate are drawn at constant screen size (see
 * `suiteGraphFace.ts`): a stack whose step shrank with the zoom would vanish
 * exactly where the graph is shown.
 *
 * Everything here is pure: same depth in, same offset out, no clock, no world.
 */

/**
 * The deepest level that still draws a step. A portal nested ten levels down is
 * a deeper plate in the document but the same plate on the screen: past this the
 * stack stops, because a longer one only smears the face it is meant to lift.
 */
export const GRAPH_DEPTH_MAX = 6;

/** The step one level takes, CSS px — up and left, so the stack reads bottom-right. */
export const GRAPH_DEPTH_STEP_PX = 5;

/** How much smaller each level draws, as a fraction of the surface's size. */
export const GRAPH_DEPTH_SCALE_STEP = 0.04;

/** No face shrinks below this, however deep it is drawn. */
export const GRAPH_DEPTH_MIN_SCALE = 0.7;

/** One level's projection: where its face sits and how strongly it casts. */
export interface GraphDepthOffset {
  /** The level this was read at — `depth` clamped to `0 … GRAPH_DEPTH_MAX`. */
  readonly level: number;
  /** Screen offset from the footprint's own centre, CSS px. Negative is up/left. */
  readonly dx: number;
  readonly dy: number;
  /** The face's scale at this level, `1` at the surface, never below `GRAPH_DEPTH_MIN_SCALE`. */
  readonly scale: number;
  /** Shadow weight, `0` at the surface … `1` at the deepest level. */
  readonly shadow: number;
}

/**
 * The integer level a derived depth draws at: rounded (depth arrives as a whole
 * number, so this only absorbs a fractional hand edit), clamped both ways, and
 * `0` for anything unusable — a node with a broken depth is a surface node, not
 * a missing one.
 */
export function graphDepthLevel(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return 0;
  const level = Math.round(depth);
  if (level <= 0) return 0;
  return Math.min(GRAPH_DEPTH_MAX, level);
}

/**
 * One level's projection. Zero is the identity exactly — no offset, full size,
 * no shadow — so a graph with no nesting draws flat, with no special case at the
 * kinds.
 */
export function graphDepthOffset(depth: number | undefined): GraphDepthOffset {
  const level = graphDepthLevel(depth);
  if (level === 0) return { level: 0, dx: 0, dy: 0, scale: 1, shadow: 0 };
  return {
    level,
    // Up-left: screen y grows down, so both are negative and the pile sits
    // bottom-right of the face — the plates read as a stack under the top sheet
    // without ever covering the text drawn on it.
    dx: -GRAPH_DEPTH_STEP_PX * level,
    dy: -GRAPH_DEPTH_STEP_PX * level,
    scale: Math.max(GRAPH_DEPTH_MIN_SCALE, 1 - GRAPH_DEPTH_SCALE_STEP * level),
    shadow: level / GRAPH_DEPTH_MAX,
  };
}
