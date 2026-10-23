/**
 * The type graph: what the canvas aggregates into at the ceiling (ADR-0037).
 *
 * At the top of the zoom range a board is too big to read card by card, so the
 * same layout is summarised: one node per (container, type) pair, inside the
 * container that holds those cards, with a count. This is a *projection of the
 * spatial layout*, not a second one — every position is derived from members'
 * own positions, nothing is stored, and no document write originates here.
 *
 * Determinism is a requirement, not a nicety: two clients at the same revision
 * must draw the same graph, and a re-render must not shuffle it. So every
 * decision below is ordered (containers by id, types by id, grid in reading
 * order) and every tie is broken by a stable key.
 *
 * No reference edges, ever (ADR-0019): the only edges here are containment —
 * the container that holds a cluster to the cluster. A reference is a row in the
 * outline or a predicate in a filter.
 */

import type { Point, Rect, ScenePlacementInput, SceneSectionInput } from "./types";

/** The slice of a card the graph needs. */
export interface TypeGraphCardInput {
  readonly id: string;
  readonly primaryTypeId: string;
}

/** The slice of a card type the graph needs. */
export interface TypeGraphTypeInput {
  readonly id: string;
  readonly name: string;
  readonly glyph: string;
  readonly color?: string | undefined;
}

export interface TypeGraphInput {
  readonly boardId: string;
  readonly cards: readonly TypeGraphCardInput[];
  readonly placements: readonly ScenePlacementInput[];
  readonly sections: readonly SceneSectionInput[];
  readonly types: readonly TypeGraphTypeInput[];
  /**
   * How many portal levels deep this View is. A graph seen inside a portal sits
   * a layer down, which is what gives the ceiling its stack.
   */
  readonly depth?: number | undefined;
}

/** What a graph node stands for. */
export type TypeGraphNodeKind = "container" | "type";

export interface TypeGraphNode {
  /** Stable across renders and clients: `container:<id>` or `type:<container>:<type>`. */
  readonly key: string;
  readonly kind: TypeGraphNodeKind;
  readonly label: string;
  readonly glyph: string;
  /** Cards aggregated here; the sum of its type clusters, not its descendants'. */
  readonly count: number;
  /** The section id this belongs to, or null for the board's unfiled bucket. */
  readonly containerId: string | null;
  readonly typeId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Derived nesting: portal depth + how many sections contain this one. */
  readonly depth: number;
  readonly color?: string | undefined;
}

/** A containment edge: a container to one of its clusters. Never a reference. */
export interface TypeGraphEdge {
  readonly key: string;
  readonly source: string;
  readonly target: string;
}

export interface TypeGraph {
  readonly nodes: readonly TypeGraphNode[];
  readonly edges: readonly TypeGraphEdge[];
  /**
   * Union of every node's frame, not just the containers: a frame too small for
   * its grid lets cells spill, and the camera must still fit them.
   */
  readonly bounds: Rect;
  /** Cards the graph accounted for, and the ones it skipped (no record). */
  readonly counted: number;
  readonly skipped: number;
}

/**
 * A fallback zoom for a View that fits nothing: the deepest scale at which a
 * card is still a card (the `icon` floor of ADR-0036). Only used where a camera
 * number is required and there is no content to derive one from — never as a
 * limit on the camera, which keeps whatever range the engine gives it.
 */
export const EMPTY_VIEW_ZOOM = 0.12;

/** The key of the bucket for cards no section holds. */
export function looseContainerKey(boardId: string): string {
  return `container:__loose__:${boardId}`;
}

export const LOOSE_CONTAINER_LABEL = "Unfiled";
const CONTAINER_GLYPH = "\u25a4";
const LOOSE_GLYPH = "\u2022";

/** Type-node cell, world units. Small frames clamp these and let cells spill. */
const CELL = { width: 96, height: 64, gap: 8 } as const;
const CELL_MIN = { width: 28, height: 22 } as const;
/** A container smaller than this cannot hold a grid; nodes sit beside it. */
const FRAME_MIN = { width: 48, height: 40 } as const;
const LOOSE_PAD = 24;

function rectOf(section: SceneSectionInput): Rect {
  return { x: section.x, y: section.y, width: section.width, height: section.height };
}

function centreOf(
  placement: ScenePlacementInput,
  natural: { width: number; height: number },
): Point {
  const width = placement.width ?? natural.width;
  const height = placement.height ?? natural.height;
  return { x: placement.x + width / 2, y: placement.y + height / 2 };
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function fullyContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) return null;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/** Natural card size when a placement stores none — Suite's default card. */
const NATURAL = { width: 288, height: 240 } as const;

/**
 * Which section holds a point: the smallest area that contains it, so a card in
 * a section nested inside a bigger one belongs to the inner one. Ties break on
 * id, so two clients agree.
 */
function smallestContaining(sections: readonly SceneSectionInput[], point: Point) {
  let best: SceneSectionInput | null = null;
  for (const section of sections) {
    if (!contains(rectOf(section), point)) continue;
    if (best === null) {
      best = section;
      continue;
    }
    const area = section.width * section.height;
    const bestArea = best.width * best.height;
    if (area < bestArea || (area === bestArea && section.id < best.id)) best = section;
  }
  return best;
}

/** How many sections contain this one — the derived nesting depth. */
function nestingDepth(sections: readonly SceneSectionInput[], section: SceneSectionInput): number {
  const own = rectOf(section);
  let depth = 0;
  for (const other of sections) {
    if (other.id === section.id) continue;
    if (fullyContains(rectOf(other), own)) depth += 1;
  }
  return depth;
}

/**
 * A deterministic grid inside a frame: `columns` from the square root, cells
 * shrunk (never grown) to fit and centred on the frame. A frame too small for
 * the minimum cell grows downward from its top-left, so cells may spill out of
 * the frame; the graph's `bounds` covers the nodes, not just the frames.
 */
function layoutCells(
  count: number,
  frame: Rect,
): { x: number; y: number; width: number; height: number }[] {
  if (count === 0) return [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const fit = {
    width: Math.max(
      CELL_MIN.width,
      Math.min(CELL.width, (frame.width - CELL.gap * (columns - 1)) / columns),
    ),
    height: Math.max(
      CELL_MIN.height,
      Math.min(CELL.height, (frame.height - CELL.gap * (rows - 1)) / rows),
    ),
  };
  const gridWidth = fit.width * columns + CELL.gap * (columns - 1);
  const gridHeight = fit.height * rows + CELL.gap * (rows - 1);
  const originX = frame.width >= gridWidth ? frame.x + (frame.width - gridWidth) / 2 : frame.x;
  const originY = frame.height >= gridHeight ? frame.y + (frame.height - gridHeight) / 2 : frame.y;
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cells.push({
      x: originX + column * (fit.width + CELL.gap),
      y: originY + row * (fit.height + CELL.gap),
      width: fit.width,
      height: fit.height,
    });
  }
  return cells;
}

const EMPTY_BOUNDS: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Build the type graph for one board. Pure: no clocks, no randomness, no writes.
 *
 * Cards with no placement on this board, or whose card record is missing from
 * `cards`, are skipped and counted — the graph never invents a card.
 */
export function buildTypeGraph(input: TypeGraphInput): TypeGraph {
  const { boardId, depth = 0 } = input;
  const sections = input.sections.filter((section) => section.boardId === boardId);
  const typeById = new Map(input.types.map((type) => [type.id, type]));
  const cardById = new Map(input.cards.map((card) => [card.id, card]));
  const sectionsByArea = [...sections].sort((a, b) => {
    const area = a.width * a.height - b.width * b.height;
    return area === 0 ? a.id.localeCompare(b.id) : area;
  });

  /** container id (or null) → type id → member placements. */
  const groups = new Map<string | null, Map<string, ScenePlacementInput[]>>();
  let counted = 0;
  let skipped = 0;
  const unfiledRects: Rect[] = [];

  for (const placement of input.placements) {
    if (placement.boardId !== boardId) continue;
    const card = cardById.get(placement.cardId);
    if (card === undefined) {
      skipped += 1;
      continue;
    }
    counted += 1;
    const holder = smallestContaining(sectionsByArea, centreOf(placement, NATURAL));
    const containerId = holder?.id ?? null;
    let byType = groups.get(containerId);
    if (byType === undefined) {
      byType = new Map();
      groups.set(containerId, byType);
    }
    const members = byType.get(card.primaryTypeId);
    if (members === undefined) byType.set(card.primaryTypeId, [placement]);
    else members.push(placement);
    if (holder === null) {
      unfiledRects.push({
        x: placement.x,
        y: placement.y,
        width: placement.width ?? NATURAL.width,
        height: placement.height ?? NATURAL.height,
      });
    }
  }

  const nodes: TypeGraphNode[] = [];
  const edges: TypeGraphEdge[] = [];

  const containerIds: (string | null)[] = [...sections.map((section) => section.id)];
  if ((groups.get(null)?.size ?? 0) > 0) containerIds.push(null);
  containerIds.sort((a, b) => (a ?? "").localeCompare(b ?? ""));

  for (const containerId of containerIds) {
    const byType = groups.get(containerId);
    if (byType === undefined || byType.size === 0) continue;
    const section =
      containerId === null ? undefined : sections.find((entry) => entry.id === containerId);
    const frame =
      section !== undefined
        ? rectOf(section)
        : (union(unfiledRects) ?? { x: 0, y: 0, width: LOOSE_PAD * 2, height: LOOSE_PAD * 2 });
    const padded: Rect =
      section !== undefined
        ? frame
        : {
            x: frame.x - LOOSE_PAD,
            y: frame.y - LOOSE_PAD,
            width: frame.width + LOOSE_PAD * 2,
            height: frame.height + LOOSE_PAD * 2,
          };
    const containerDepth = depth + (section === undefined ? 0 : nestingDepth(sections, section));
    const containerKey =
      section === undefined ? looseContainerKey(boardId) : `container:${section.id}`;
    let total = 0;
    for (const members of byType.values()) total += members.length;

    nodes.push({
      key: containerKey,
      kind: "container",
      label:
        section?.title !== undefined && section.title.length > 0
          ? section.title
          : LOOSE_CONTAINER_LABEL,
      glyph: section === undefined ? LOOSE_GLYPH : CONTAINER_GLYPH,
      count: total,
      containerId,
      typeId: null,
      x: padded.x,
      y: padded.y,
      width: padded.width >= FRAME_MIN.width ? padded.width : FRAME_MIN.width,
      height: padded.height >= FRAME_MIN.height ? padded.height : FRAME_MIN.height,
      depth: containerDepth,
      ...(section?.color === undefined ? {} : { color: section.color }),
    });

    const typeIds = [...byType.keys()].sort((a, b) => a.localeCompare(b));
    const cells = layoutCells(typeIds.length, {
      x: padded.x,
      y: padded.y,
      width: Math.max(FRAME_MIN.width, padded.width),
      height: Math.max(FRAME_MIN.height, padded.height),
    });
    typeIds.forEach((typeId, index) => {
      const members = byType.get(typeId) ?? [];
      const type = typeById.get(typeId);
      const cell = cells[index];
      if (cell === undefined) return;
      const key = `type:${containerId ?? `__loose__:${boardId}`}:${typeId}`;
      nodes.push({
        key,
        kind: "type",
        label: type?.name ?? typeId,
        glyph: type?.glyph ?? "\u25a1",
        count: members.length,
        containerId,
        typeId,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        depth: containerDepth + 1,
        ...(type?.color === undefined ? {} : { color: type.color }),
      });
      edges.push({ key: `${containerKey}->${key}`, source: containerKey, target: key });
    });
  }

  const bounds =
    union(
      nodes.map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height })),
    ) ?? EMPTY_BOUNDS;

  return { nodes, edges, bounds, counted, skipped };
}
