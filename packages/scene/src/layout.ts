import { fitTransform, rectIntersection, rectUnionAll } from "./geometry.js";
import type {
  FractalRecipe,
  LayoutAlign,
  LayoutClusterBy,
  LayoutOrder,
  LayoutPattern,
  Point,
  Rect,
  Transform,
} from "./types.js";

export type {
  FractalRecipe,
  LayoutAlign,
  LayoutClusterBy,
  LayoutDepthRecipe,
  LayoutOrder,
  LayoutPattern,
} from "./types.js";

/**
 * Pure, one-shot fractal layout plans. A plan is a proposal: the caller previews
 * it and applies it through the graph layer in one undoable batch.
 */

export const LAYOUT_PATTERNS: readonly LayoutPattern[] = [
  "grid",
  "columns",
  "rows",
  "radial",
  "spiral",
  "phyllotaxis",
  "rings",
  "treemap",
];

export const DEFAULT_LAYOUT_MAX_DEPTH = 6;

/** A flat plan: one arrangement of the board's cards. */
export const DEFAULT_FRACTAL_LEVELS = 1;
/** Three clusters per level reads as a spiral of spirals without becoming noise. */
export const DEFAULT_FRACTAL_BRANCHING = 3;
/** Half the area per level: the area step a nested frame wants. */
export const DEFAULT_FRACTAL_SCALE_STEP = 1 / Math.SQRT2;

export const DEFAULT_FRACTAL_RECIPE: FractalRecipe = {
  pattern: "grid",
  gap: 48,
  padding: 64,
  align: "start",
  order: "reading",
  jitter: 0,
  seed: 1,
  depth: { scale: 0.35, gap: 24, rotate: 0 },
};

/**
 * A spiral at every scale: the board's cards cluster, each cluster is a spiral,
 * each of its clusters is a spiral again, and the cards shrink by 1/√2 a level.
 */
export const FRACTAL_SPIRAL_RECIPE: FractalRecipe = {
  pattern: "spiral",
  gap: 48,
  padding: 64,
  align: "center",
  order: "reading",
  jitter: 0,
  seed: 1,
  depth: { scale: 0.35, gap: 24, rotate: 0 },
  levels: 3,
  branching: 3,
  scaleStep: DEFAULT_FRACTAL_SCALE_STEP,
  cluster: "order",
};

export interface LayoutItem {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly z?: number | undefined;
  readonly createdAt?: number | undefined;
  readonly typeId?: string | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly pinned?: boolean | undefined;
  readonly excluded?: boolean | undefined;
  /** Tags, used only when the recipe clusters by tag. */
  readonly tags?: readonly string[] | undefined;
  /** Target board id when the item is a portal card. */
  readonly portalBoardId?: string | undefined;
}

export interface LayoutPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Rotation hint in radians; rects stay axis-aligned for non-overlap checks. */
  readonly rotate: number;
  readonly depth: number;
  /**
   * Cumulative size step of the arrangement level that placed this card.
   * Absent on a flat plan, where every card keeps its own size.
   */
  readonly scale?: number | undefined;
  /** 1-based arrangement level; derived from `scale`, never set independently. */
  readonly rung?: number | undefined;
}

export type LayoutIssueCode = "cycle" | "depth" | "missing-board" | "overlap";

export interface LayoutIssue {
  readonly code: LayoutIssueCode;
  readonly message: string;
  readonly itemId?: string | undefined;
}

export interface PortalLayoutPlan {
  readonly cardId: string;
  readonly targetBoardId: string;
  /** Child board path, including the target board. */
  readonly path: readonly string[];
  readonly frame: Rect;
  /** Child board coordinates -> parent page coordinates. */
  readonly fit: Transform;
  readonly child: LayoutPlan | null;
  readonly cycle: boolean;
  readonly depthCapped: boolean;
  readonly missing: boolean;
}

/**
 * A container the plan proposes for one cluster. Proposals are never written:
 * they say "this group of cards would read better inside a Board of this size,
 * here", and the caller decides whether to create it.
 */
export interface LayoutProposal {
  /** The board the proposed container would sit on. */
  readonly boardId: string;
  readonly name: string;
  /** Arrangement level of the cluster; 1 is the board's own level. */
  readonly level: number;
  /** Frame-local rect in the parent board's coordinates. */
  readonly rect: Rect;
  /** Cards the container would hold. */
  readonly ids: readonly string[];
}

export interface LayoutPlan {
  readonly boardId: string;
  readonly path: readonly string[];
  readonly depth: number;
  readonly pattern: LayoutPattern;
  readonly gap: number;
  readonly placements: readonly LayoutPlacement[];
  readonly bounds: Rect | null;
  readonly portals: readonly PortalLayoutPlan[];
  readonly issues: readonly LayoutIssue[];
  /** Clusters that could become real containers; only when the recipe nests. */
  readonly proposals?: readonly LayoutProposal[] | undefined;
}

export interface FractalLayoutInput {
  readonly rootBoardId: string;
  /** Board id -> its cards, in any order (the recipe order decides). */
  readonly boards: Readonly<Record<string, readonly LayoutItem[]>>;
  readonly recipe: FractalRecipe;
  readonly origin?: Point | undefined;
  readonly maxDepth?: number | undefined;
}

export interface ArrangeOptions {
  readonly gap?: number | undefined;
  readonly align?: LayoutAlign | undefined;
  readonly rotate?: number | undefined;
  readonly jitter?: number | undefined;
  readonly seed?: number | undefined;
  readonly order?: LayoutOrder | undefined;
  /** Force the column count (grid/columns) or row count (rows). */
  readonly lanes?: number | undefined;
  readonly depth?: number | undefined;
}

type SizedItem = Pick<LayoutItem, "width" | "height">;

function alignOffset(align: LayoutAlign, slack: number): number {
  if (slack <= 0) return 0;
  if (align === "center") return slack / 2;
  if (align === "end") return slack;
  return 0;
}

function maxOf(values: readonly number[]): number {
  return values.reduce((highest, value) => Math.max(highest, value), 0);
}

function circumradius(item: SizedItem): number {
  return Math.hypot(item.width, item.height) / 2;
}

function normalize(rects: readonly Rect[]): Rect[] {
  const union = rectUnionAll(rects);
  if (!union) return [];
  return rects.map((value) => ({
    x: value.x - union.x,
    y: value.y - union.y,
    width: value.width,
    height: value.height,
  }));
}

function gridRects(
  items: readonly SizedItem[],
  gap: number,
  align: LayoutAlign,
  lanes?: number,
): Rect[] {
  if (items.length === 0) return [];
  const widest = maxOf(items.map((item) => item.width));
  const tallest = maxOf(items.map((item) => item.height));
  const columns = Math.max(1, lanes ?? Math.ceil(Math.sqrt(items.length)));
  const cellWidth = widest + gap;
  const cellHeight = tallest + gap;
  return items.map((item, index) => ({
    x: (index % columns) * cellWidth + alignOffset(align, widest - item.width),
    y: Math.floor(index / columns) * cellHeight + (tallest - item.height) / 2,
    width: item.width,
    height: item.height,
  }));
}

function columnRects(
  items: readonly SizedItem[],
  gap: number,
  align: LayoutAlign,
  lanes?: number,
): Rect[] {
  if (items.length === 0) return [];
  const columns = Math.max(1, Math.min(items.length, lanes ?? Math.ceil(Math.sqrt(items.length))));
  const base = Math.floor(items.length / columns);
  const extra = items.length % columns;
  const rects: Rect[] = [];
  let cursorX = 0;
  let index = 0;
  for (let column = 0; column < columns; column += 1) {
    const count = base + (column < extra ? 1 : 0);
    const slice = items.slice(index, index + count);
    index += count;
    const columnWidth = maxOf(slice.map((item) => item.width));
    let cursorY = 0;
    for (const item of slice) {
      rects.push({
        x: cursorX + alignOffset(align, columnWidth - item.width),
        y: cursorY,
        width: item.width,
        height: item.height,
      });
      cursorY += item.height + gap;
    }
    cursorX += columnWidth + gap;
  }
  return rects;
}

function rowRects(
  items: readonly SizedItem[],
  gap: number,
  align: LayoutAlign,
  lanes?: number,
): Rect[] {
  if (items.length === 0) return [];
  const rows = Math.max(1, Math.min(items.length, lanes ?? Math.ceil(Math.sqrt(items.length))));
  const base = Math.floor(items.length / rows);
  const extra = items.length % rows;
  const chunks: SizedItem[][] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    const count = base + (row < extra ? 1 : 0);
    chunks.push(items.slice(index, index + count));
    index += count;
  }
  const rowWidth = (slice: readonly SizedItem[]) =>
    slice.reduce((sum, item, position) => sum + item.width + (position > 0 ? gap : 0), 0);
  const widestRow = maxOf(chunks.map(rowWidth));
  const rects: Rect[] = [];
  let cursorY = 0;
  for (const slice of chunks) {
    const rowHeight = maxOf(slice.map((item) => item.height));
    let cursorX = alignOffset(align, widestRow - rowWidth(slice));
    for (const item of slice) {
      rects.push({ x: cursorX, y: cursorY, width: item.width, height: item.height });
      cursorX += item.width + gap;
    }
    cursorY += rowHeight + gap;
  }
  return rects;
}

function radialRects(items: readonly SizedItem[], gap: number): Rect[] {
  if (items.length === 0) return [];
  const spread = 2 * maxOf(items.map(circumradius)) + gap;
  const radius = items.length === 1 ? 0 : spread / (2 * Math.sin(Math.PI / items.length));
  return items.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / items.length;
    return {
      x: Math.cos(angle) * radius - item.width / 2,
      y: Math.sin(angle) * radius - item.height / 2,
      width: item.width,
      height: item.height,
    };
  });
}

/** Logarithmic spiral: arc spacing and turn spacing both grow with the radius. */
function spiralRects(items: readonly SizedItem[], gap: number): Rect[] {
  if (items.length === 0) return [];
  const step = 2 * maxOf(items.map(circumradius)) + gap;
  const delta = 0.5;
  const startRadius = step / delta;
  return items.map((item, index) => {
    const angle = index * delta;
    const radius = startRadius * Math.exp(0.2 * angle);
    return {
      x: Math.cos(angle) * radius - item.width / 2,
      y: Math.sin(angle) * radius - item.height / 2,
      width: item.width,
      height: item.height,
    };
  });
}

function phyllotaxisRects(items: readonly SizedItem[], gap: number): Rect[] {
  if (items.length === 0) return [];
  const spacing = 2 * maxOf(items.map(circumradius)) + gap;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return items.map((item, index) => {
    const radius = spacing * Math.sqrt(index);
    const angle = index * goldenAngle;
    return {
      x: Math.cos(angle) * radius - item.width / 2,
      y: Math.sin(angle) * radius - item.height / 2,
      width: item.width,
      height: item.height,
    };
  });
}

function ringRects(items: readonly SizedItem[], gap: number): Rect[] {
  if (items.length === 0) return [];
  const spacing = 2 * maxOf(items.map(circumradius)) + gap;
  const rects: Rect[] = [];
  let index = 0;
  let ring = 0;
  while (index < items.length) {
    const radius = ring * spacing;
    const capacity =
      ring === 0 ? 1 : Math.max(1, Math.floor((2 * Math.PI * radius) / (spacing * 1.05)));
    const count = Math.min(capacity, items.length - index);
    for (let slot = 0; slot < count; slot += 1) {
      const item = items[index + slot];
      if (!item) continue;
      const angle = (2 * Math.PI * slot) / capacity - Math.PI / 2;
      const centerX = ring === 0 ? 0 : Math.cos(angle) * radius;
      const centerY = ring === 0 ? 0 : Math.sin(angle) * radius;
      rects.push({
        x: centerX - item.width / 2,
        y: centerY - item.height / 2,
        width: item.width,
        height: item.height,
      });
    }
    index += count;
    ring += 1;
  }
  return rects;
}

function worstRatio(areas: readonly number[], side: number): number {
  const total = areas.reduce((sum, area) => sum + area, 0);
  if (total <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
  const largest = Math.max(...areas);
  const smallest = Math.min(...areas);
  const sideSquared = side * side;
  return Math.max(
    (sideSquared * largest) / (total * total),
    (total * total) / (sideSquared * smallest),
  );
}

/** Squarified treemap: cells partition the container, so they never overlap. */
function squarify(areas: readonly number[], bounds: Rect): Rect[] {
  const rects: Rect[] = [];
  const remaining = [...areas];
  let free: Rect = bounds;
  while (remaining.length > 0) {
    const shortSide = Math.min(free.width, free.height);
    if (shortSide <= 0) break;
    const row: number[] = [];
    let best = Number.POSITIVE_INFINITY;
    while (remaining.length > 0) {
      const next = remaining[0];
      if (next === undefined) break;
      const candidate = [...row, next];
      const ratio = worstRatio(candidate, shortSide);
      if (row.length === 0 || ratio <= best) {
        row.push(next);
        remaining.shift();
        best = ratio;
      } else {
        break;
      }
    }
    const rowArea = row.reduce((sum, area) => sum + area, 0);
    if (rowArea <= 0 || free.width <= 0 || free.height <= 0) break;
    if (free.width >= free.height) {
      const columnWidth = Math.min(free.width, rowArea / free.height);
      let y = free.y;
      for (const area of row) {
        const height = Math.min(free.height - (y - free.y), area / columnWidth);
        rects.push({ x: free.x, y, width: columnWidth, height: Math.max(0, height) });
        y += height;
      }
      free = {
        x: free.x + columnWidth,
        y: free.y,
        width: Math.max(0, free.width - columnWidth),
        height: free.height,
      };
    } else {
      const rowHeight = Math.min(free.height, rowArea / free.width);
      let x = free.x;
      for (const area of row) {
        const width = Math.min(free.width - (x - free.x), area / rowHeight);
        rects.push({ x, y: free.y, width: Math.max(0, width), height: rowHeight });
        x += width;
      }
      free = {
        x: free.x,
        y: free.y + rowHeight,
        width: free.width,
        height: Math.max(0, free.height - rowHeight),
      };
    }
  }
  return rects;
}

function treemapRects(items: readonly SizedItem[], gap: number): Rect[] {
  if (items.length === 0) return [];
  const weights = items.map(
    (item) => Math.max(1, item.width + gap) * Math.max(1, item.height + gap),
  );
  const totalArea = weights.reduce((sum, weight) => sum + weight, 0);
  const aspect = 1.35;
  let width = Math.sqrt(totalArea * aspect);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const container: Rect = { x: 0, y: 0, width, height: totalArea / width };
    const cells = squarify(weights, container);
    const fits = cells.every((cell, index) => {
      const item = items[index];
      return !item || (cell.width + 1e-6 >= item.width && cell.height + 1e-6 >= item.height);
    });
    if (fits) {
      return cells.map((cell, index) => {
        const item = items[index];
        if (!item) return cell;
        return {
          x: cell.x + (cell.width - item.width) / 2,
          y: cell.y + (cell.height - item.height) / 2,
          width: item.width,
          height: item.height,
        };
      });
    }
    width *= 1.25;
  }
  return gridRects(items, gap, "center");
}

function patternRects(
  items: readonly SizedItem[],
  pattern: LayoutPattern,
  gap: number,
  align: LayoutAlign,
  lanes?: number,
): Rect[] {
  switch (pattern) {
    case "grid":
      return gridRects(items, gap, align, lanes);
    case "columns":
      return columnRects(items, gap, align, lanes);
    case "rows":
      return rowRects(items, gap, align, lanes);
    case "radial":
      return normalize(radialRects(items, gap));
    case "spiral":
      return normalize(spiralRects(items, gap));
    case "phyllotaxis":
      return normalize(phyllotaxisRects(items, gap));
    case "rings":
      return normalize(ringRects(items, gap));
    case "treemap":
      return normalize(treemapRects(items, gap));
  }
}

function compareItems(order: LayoutOrder) {
  return (a: LayoutItem, b: LayoutItem): number => {
    if (order === "z") return (a.z ?? 0) - (b.z ?? 0) || a.id.localeCompare(b.id);
    if (order === "created") {
      return (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id);
    }
    if (order === "type") {
      return (a.typeId ?? "").localeCompare(b.typeId ?? "") || a.id.localeCompare(b.id);
    }
    return (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0) || a.id.localeCompare(b.id);
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per item, so re-running a plan reproduces the same jitter. */
function jitterFor(seed: number, id: string): () => number {
  return mulberry32((hashString(id) ^ Math.imul(seed, 2654435761)) >>> 0);
}

export function overlappingPlacements(
  placements: readonly LayoutPlacement[],
  tolerance = 0.5,
): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let first = 0; first < placements.length; first += 1) {
    const a = placements[first];
    if (!a) continue;
    for (let second = first + 1; second < placements.length; second += 1) {
      const b = placements[second];
      if (!b) continue;
      if (rectIntersection(a, b, tolerance)) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

/**
 * Arrange one level. Pinned items keep their coordinates; excluded items are
 * left alone (no placement). Rotation is metadata, never applied to rectangles.
 */
export function arrangeItems(
  items: readonly LayoutItem[],
  pattern: LayoutPattern,
  options: ArrangeOptions = {},
): readonly LayoutPlacement[] {
  const gap = Math.max(0, options.gap ?? DEFAULT_FRACTAL_RECIPE.gap);
  const align = options.align ?? "start";
  const rotate = options.rotate ?? 0;
  const jitter = Math.max(0, options.jitter ?? 0);
  const seed = options.seed ?? 1;
  const depth = options.depth ?? 0;
  const order = options.order ?? "reading";

  const placements: LayoutPlacement[] = [];
  const flow: LayoutItem[] = [];
  for (const item of items) {
    if (item.excluded) continue;
    if (item.pinned) {
      placements.push({
        id: item.id,
        x: item.x ?? 0,
        y: item.y ?? 0,
        width: item.width,
        height: item.height,
        rotate,
        depth,
      });
      continue;
    }
    flow.push(item);
  }

  const sorted = [...flow].sort(compareItems(order));
  const rects = patternRects(sorted, pattern, gap, align, options.lanes);
  sorted.forEach((item, index) => {
    const cell = rects[index];
    if (!cell) return;
    const random = jitterFor(seed, item.id);
    const dx = jitter === 0 ? 0 : (random() * 2 - 1) * jitter;
    const dy = jitter === 0 ? 0 : (random() * 2 - 1) * jitter;
    placements.push({
      id: item.id,
      x: cell.x + dx,
      y: cell.y + dy,
      width: cell.width,
      height: cell.height,
      rotate,
      depth,
    });
  });
  return placements;
}

export interface ClusterOptions {
  /** Clusters to split into; a value below 2 keeps one cluster. */
  readonly branching?: number | undefined;
  readonly cluster?: LayoutClusterBy | undefined;
  /** Order used to sort items before they are cut into contiguous runs. */
  readonly order?: LayoutOrder | undefined;
}

function clusterKey(item: LayoutItem, by: LayoutClusterBy): string {
  if (by === "type") return item.typeId ?? "";
  if (by === "tag") {
    const tags = item.tags;
    if (!tags || tags.length === 0) return "";
    return [...tags].sort((a, b) => a.localeCompare(b))[0] ?? "";
  }
  return "";
}

/** Cut sorted items into contiguous runs of `ceil(n / branching)`. */
function contiguousClusters(
  sorted: readonly LayoutItem[],
  branching: number,
): readonly (readonly LayoutItem[])[] {
  const size = Math.max(1, Math.ceil(sorted.length / branching));
  const chunks: LayoutItem[][] = [];
  for (let index = 0; index < sorted.length; index += size) {
    chunks.push(sorted.slice(index, index + size));
  }
  return chunks;
}

/**
 * Group items into clusters deterministically. `"order"` cuts the sorted items
 * into contiguous runs of `ceil(n / branching)`, so the grouping never depends
 * on data the caller did not pass; `"type"` and `"tag"` group by key first, fold
 * groups together when a board has more keys than clusters, and fall back to
 * contiguous runs once every item left shares one key — otherwise the key would
 * stop the recursion dead. A board that cannot fill one item per cluster stays
 * whole.
 */
export function clusterItems(
  items: readonly LayoutItem[],
  options: ClusterOptions = {},
): readonly (readonly LayoutItem[])[] {
  const branching = Math.max(1, Math.floor(options.branching ?? DEFAULT_FRACTAL_BRANCHING));
  const by = options.cluster ?? "order";
  const sorted = [...items].sort(compareItems(options.order ?? "reading"));
  if (sorted.length === 0) return [];
  if (sorted.length <= branching) return [sorted];
  if (branching === 1 || by === "order") return contiguousClusters(sorted, branching);
  const groups = new Map<string, LayoutItem[]>();
  for (const item of sorted) {
    const key = clusterKey(item, by);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  // Untagged cards have no key to sort on, so their bucket goes last.
  const ordered = [...groups.entries()]
    .sort(([first], [second]) => (first || "\uffff").localeCompare(second || "\uffff"))
    .map(([, bucket]) => bucket);
  if (ordered.length === 1) return contiguousClusters(sorted, branching);
  if (ordered.length <= branching) return ordered;
  const buckets: LayoutItem[][] = Array.from({ length: branching }, () => []);
  for (const group of ordered) {
    let smallest = 0;
    for (let index = 1; index < buckets.length; index += 1) {
      if ((buckets[index]?.length ?? 0) < (buckets[smallest]?.length ?? 0)) smallest = index;
    }
    buckets[smallest]?.push(...group);
  }
  return buckets.filter((bucket) => bucket.length > 0);
}

export interface FractalArrangeOptions extends ArrangeOptions {
  /** Arrangement levels; 1 is the flat plan. */
  readonly levels?: number | undefined;
  readonly branching?: number | undefined;
  readonly scaleStep?: number | undefined;
  readonly cluster?: LayoutClusterBy | undefined;
  /** Also propose a container per cluster (pure proposal, never written). */
  readonly nest?: boolean | undefined;
  /** Board the proposals would live on; ignored when `nest` is off. */
  readonly boardId?: string | undefined;
}

interface FractalContext {
  readonly pattern: LayoutPattern;
  readonly gap: number;
  readonly align: LayoutAlign;
  readonly rotate: number;
  readonly jitter: number;
  readonly seed: number;
  readonly order: LayoutOrder;
  readonly levels: number;
  readonly branching: number;
  readonly scaleStep: number;
  readonly cluster: LayoutClusterBy;
  readonly depth: number;
  readonly nest: boolean;
  readonly boardId: string;
}

interface FractalPatch {
  readonly placements: readonly LayoutPlacement[];
  readonly proposals: readonly LayoutProposal[];
}

interface FractalUnit {
  readonly patch: FractalPatch;
  readonly bounds: Rect;
  /** Set when the unit is a real cluster the caller may want as a container. */
  readonly cluster?: { readonly level: number; readonly ids: readonly string[] } | undefined;
}

const EMPTY_PATCH: FractalPatch = { placements: [], proposals: [] };

const PATTERN_LABELS: Record<LayoutPattern, string> = {
  grid: "Grid",
  columns: "Columns",
  rows: "Rows",
  radial: "Radial",
  spiral: "Spiral",
  phyllotaxis: "Phyllotaxis",
  rings: "Rings",
  treemap: "Treemap",
};

function translatePatch(patch: FractalPatch, dx: number, dy: number): FractalPatch {
  return {
    placements: patch.placements.map((placement) => ({
      ...placement,
      x: placement.x + dx,
      y: placement.y + dy,
    })),
    proposals: patch.proposals.map((proposal) => ({
      ...proposal,
      rect: {
        ...proposal.rect,
        x: proposal.rect.x + dx,
        y: proposal.rect.y + dy,
      },
    })),
  };
}

function scaleItem(item: LayoutItem, scale: number): LayoutItem {
  return {
    ...item,
    width: Math.max(0, item.width * scale),
    height: Math.max(0, item.height * scale),
  };
}

/** Place the items that an arrangement level owns: cards, at that level's scale. */
function placeLeaf(
  items: readonly LayoutItem[],
  level: number,
  scale: number,
  ctx: FractalContext,
): FractalPatch {
  const placements = arrangeItems(
    items.map((item) => scaleItem(item, scale)),
    ctx.pattern,
    {
      gap: ctx.gap * scale,
      align: ctx.align,
      rotate: ctx.rotate,
      jitter: ctx.jitter,
      seed: ctx.seed,
      order: ctx.order,
      depth: ctx.depth,
    },
  );
  return {
    placements: placements.map((placement) => ({ ...placement, scale, rung: level })),
    proposals: [],
  };
}

/** Arrange already-planned clusters by the same pattern, at this level's scale. */
function arrangeUnits(
  units: readonly FractalUnit[],
  scale: number,
  ctx: FractalContext,
): FractalPatch {
  if (units.length === 0) return EMPTY_PATCH;
  const cells = patternRects(
    units.map((unit) => unit.bounds),
    ctx.pattern,
    ctx.gap * scale,
    ctx.align,
  );
  const placements: LayoutPlacement[] = [];
  const proposals: LayoutProposal[] = [];
  units.forEach((unit, index) => {
    const cell = cells[index];
    if (!cell) return;
    const patch = translatePatch(unit.patch, cell.x - unit.bounds.x, cell.y - unit.bounds.y);
    placements.push(...patch.placements);
    proposals.push(...patch.proposals);
    const cluster = unit.cluster;
    if (!ctx.nest || !cluster) return;
    proposals.push({
      boardId: ctx.boardId,
      name: `${PATTERN_LABELS[ctx.pattern]} ${cluster.level}.${index + 1}`,
      level: cluster.level,
      rect: { x: cell.x, y: cell.y, width: unit.bounds.width, height: unit.bounds.height },
      ids: cluster.ids,
    });
  });
  return { placements, proposals };
}

/**
 * Split a level's items into clusters and plan each one a level deeper. A card
 * alone in its cluster is not shrunk for a level it never uses: it keeps the
 * size of the arrangement that holds it.
 */
function clusterUnits(
  items: readonly LayoutItem[],
  level: number,
  scale: number,
  ctx: FractalContext,
): FractalUnit[] {
  const deeper = scale * ctx.scaleStep;
  const units: FractalUnit[] = [];
  for (const cluster of clusterItems(items, {
    branching: ctx.branching,
    cluster: ctx.cluster,
    order: ctx.order,
  })) {
    const patch =
      cluster.length === 1
        ? placeLeaf(cluster, level, scale, ctx)
        : fractalPlacements(cluster, level + 1, deeper, ctx);
    const bounds = rectUnionAll(patch.placements);
    if (!bounds) continue;
    units.push({
      patch,
      bounds,
      ...(cluster.length === 1 ? {} : { cluster: { level, ids: cluster.map((item) => item.id) } }),
    });
  }
  return units;
}

/** A level that cannot split any further is a leaf, however much budget is left. */
function canSplit(items: readonly LayoutItem[], ctx: FractalContext): boolean {
  return (
    clusterItems(items, {
      branching: ctx.branching,
      cluster: ctx.cluster,
      order: ctx.order,
    }).length > 1
  );
}

/**
 * The recursion: a level either places its cards (the leaves) or splits into
 * clusters, plans each cluster one level deeper at `scaleStep` of the size, and
 * then arranges the cluster boxes with the very same pattern. A spiral of
 * spirals falls out of calling this once; no preset needs a second algorithm.
 */
function fractalPlacements(
  items: readonly LayoutItem[],
  level: number,
  scale: number,
  ctx: FractalContext,
): FractalPatch {
  if (items.length === 0) return EMPTY_PATCH;
  if (items.length === 1 || level >= ctx.levels || !canSplit(items, ctx)) {
    return placeLeaf(items, level, scale, ctx);
  }
  return arrangeUnits(clusterUnits(items, level, scale, ctx), scale, ctx);
}

/**
 * Arrange items with a self-similar plan: the pattern repeats inside each of its
 * own cells, `levels` deep, shrinking by `scaleStep` each time. `levels: 1` is
 * `arrangeItems`, unchanged.
 */
export function arrangeFractal(
  items: readonly LayoutItem[],
  pattern: LayoutPattern,
  options: FractalArrangeOptions = {},
): readonly LayoutPlacement[] {
  return arrangeFractalPatches(items, pattern, options).placements;
}

/** `arrangeFractal`, plus the containers a nesting plan proposes. */
function arrangeFractalPatches(
  items: readonly LayoutItem[],
  pattern: LayoutPattern,
  options: FractalArrangeOptions,
): FractalPatch {
  const levels = Math.max(1, Math.floor(options.levels ?? DEFAULT_FRACTAL_LEVELS));
  if (levels <= 1) return { placements: arrangeItems(items, pattern, options), proposals: [] };
  const step = options.scaleStep ?? DEFAULT_FRACTAL_SCALE_STEP;
  const ctx: FractalContext = {
    pattern,
    gap: Math.max(0, options.gap ?? DEFAULT_FRACTAL_RECIPE.gap),
    align: options.align ?? "start",
    rotate: options.rotate ?? 0,
    jitter: Math.max(0, options.jitter ?? 0),
    seed: options.seed ?? 1,
    order: options.order ?? "reading",
    levels,
    branching: Math.max(1, Math.floor(options.branching ?? DEFAULT_FRACTAL_BRANCHING)),
    scaleStep: Number.isFinite(step) && step > 0 ? step : DEFAULT_FRACTAL_SCALE_STEP,
    cluster: options.cluster ?? "order",
    depth: options.depth ?? 0,
    nest: options.nest === true,
    boardId: options.boardId ?? "",
  };
  const pinned: LayoutPlacement[] = [];
  const containers: LayoutItem[] = [];
  const flow: LayoutItem[] = [];
  for (const item of items) {
    if (item.excluded) continue;
    if (item.pinned) {
      pinned.push({
        id: item.id,
        x: item.x ?? 0,
        y: item.y ?? 0,
        width: item.width,
        height: item.height,
        rotate: ctx.rotate,
        depth: ctx.depth,
        scale: 1,
        rung: 1,
      });
      continue;
    }
    if (item.portalBoardId) containers.push(item);
    else flow.push(item);
  }
  const units: FractalUnit[] = [];
  const flowPatch = fractalPlacements(flow, 1, 1, ctx);
  const flowBounds = rectUnionAll(flowPatch.placements);
  if (flowBounds) units.push({ patch: flowPatch, bounds: flowBounds });
  // A Board is a container, not a cluster member: it keeps its own extent.
  for (const container of containers) {
    const patch = placeLeaf([container], 1, 1, ctx);
    const bounds = rectUnionAll(patch.placements);
    if (bounds) units.push({ patch, bounds });
  }
  const arranged = arrangeUnits(units, 1, ctx);
  const union = rectUnionAll(arranged.placements);
  const shiftX = union?.x ?? 0;
  const shiftY = union?.y ?? 0;
  const shifted = translatePatch(arranged, -shiftX, -shiftY);
  return {
    placements: [...pinned, ...shifted.placements],
    proposals: shifted.proposals,
  };
}

interface PortalMeta {
  readonly target: string;
  readonly child: LayoutPlan | null;
  readonly cycle: boolean;
  readonly depthCapped: boolean;
  readonly missing: boolean;
}

function planBoard(
  input: FractalLayoutInput,
  boardId: string,
  path: readonly string[],
  depth: number,
  maxDepth: number,
): LayoutPlan {
  const recipe = input.recipe;
  const pattern = depth === 0 ? recipe.pattern : (recipe.depth.pattern ?? recipe.pattern);
  const gap = depth === 0 ? recipe.gap : recipe.depth.gap;
  const rotate = depth === 0 ? 0 : recipe.depth.rotate;
  const origin = input.origin ?? { x: 0, y: 0 };
  const issues: LayoutIssue[] = [];
  const raw = input.boards[boardId];
  if (!raw) {
    issues.push({ code: "missing-board", message: `Board "${boardId}" is not in the layout` });
  }
  const items = raw ?? [];
  const sized: LayoutItem[] = [];
  const portalMeta = new Map<string, PortalMeta>();

  for (const item of items) {
    if (item.excluded) continue;
    const target = item.portalBoardId;
    if (!target) {
      sized.push(item);
      continue;
    }
    const cycle = path.includes(target);
    const depthCapped = depth + 1 > maxDepth;
    const missing = input.boards[target] === undefined;
    if (cycle) {
      issues.push({
        code: "cycle",
        itemId: item.id,
        message: `Portal "${item.id}" points back at "${target}"`,
      });
    }
    if (depthCapped) {
      issues.push({
        code: "depth",
        itemId: item.id,
        message: `Portal "${item.id}" exceeds the depth cap of ${maxDepth}`,
      });
    }
    if (missing && !cycle) {
      issues.push({
        code: "missing-board",
        itemId: item.id,
        message: `Portal "${item.id}" targets a board that is not in the layout`,
      });
    }
    const child =
      cycle || depthCapped || missing
        ? null
        : planBoard(input, target, [...path, target], depth + 1, maxDepth);
    const scale = recipe.depth.scale > 0 ? recipe.depth.scale : 1;
    const childBounds = child?.bounds ?? null;
    sized.push({
      ...item,
      width: childBounds && childBounds.width > 0 ? childBounds.width * scale : item.width,
      height: childBounds && childBounds.height > 0 ? childBounds.height * scale : item.height,
    });
    portalMeta.set(item.id, { target, child, cycle, depthCapped, missing });
  }

  const arrangement = arrangeFractalPatches(sized, pattern, {
    gap,
    align: recipe.align,
    rotate,
    jitter: recipe.jitter ?? 0,
    seed: recipe.seed ?? 1,
    order: recipe.order,
    depth,
    ...(recipe.levels !== undefined ? { levels: recipe.levels } : {}),
    ...(recipe.branching !== undefined ? { branching: recipe.branching } : {}),
    ...(recipe.scaleStep !== undefined ? { scaleStep: recipe.scaleStep } : {}),
    ...(recipe.cluster !== undefined ? { cluster: recipe.cluster } : {}),
    ...(recipe.nest === true ? { nest: true, boardId } : {}),
  });
  const offsetX = origin.x + recipe.padding;
  const offsetY = origin.y + recipe.padding;
  const placements = arrangement.placements.map((placement) => ({
    ...placement,
    x: placement.x + offsetX,
    y: placement.y + offsetY,
  }));
  const proposals = arrangement.proposals.map((proposal) => ({
    ...proposal,
    rect: {
      ...proposal.rect,
      x: proposal.rect.x + offsetX,
      y: proposal.rect.y + offsetY,
    },
  }));

  const portals: PortalLayoutPlan[] = [];
  for (const [cardId, meta] of portalMeta) {
    const placement = placements.find((candidate) => candidate.id === cardId);
    if (!placement) continue;
    const frame: Rect = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    };
    const childBounds = meta.child?.bounds ?? null;
    const fit = childBounds
      ? fitTransform(childBounds, frame, 1)
      : { scale: 1, x: frame.x, y: frame.y };
    portals.push({
      cardId,
      targetBoardId: meta.target,
      path: [...path, meta.target],
      frame,
      fit,
      child: meta.child,
      cycle: meta.cycle,
      depthCapped: meta.depthCapped,
      missing: meta.missing,
    });
  }

  for (const [first, second] of overlappingPlacements(placements)) {
    issues.push({
      code: "overlap",
      message: `Placements "${first}" and "${second}" overlap`,
    });
  }

  return {
    boardId,
    path,
    depth,
    pattern,
    gap,
    placements,
    bounds: rectUnionAll(placements),
    portals,
    issues,
    ...(proposals.length > 0 ? { proposals } : {}),
  };
}

/** Recursive preset plan; never writes, never observes, safe to preview. */
export function planFractalLayout(input: FractalLayoutInput): LayoutPlan {
  const maxDepth = Math.max(0, input.maxDepth ?? DEFAULT_LAYOUT_MAX_DEPTH);
  return planBoard(input, input.rootBoardId, [input.rootBoardId], 0, maxDepth);
}
