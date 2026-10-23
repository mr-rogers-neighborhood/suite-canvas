import { rectContainsRect, rectIntersects } from "./geometry.js";
import type { Rect } from "./types.js";

export interface SpatialEntry<T> {
  readonly id: string;
  readonly bounds: Rect;
  readonly value: T;
}

export interface SpatialIndexOptions {
  readonly bounds?: Rect;
  readonly capacity?: number;
  readonly maxDepth?: number;
}

interface QuadNode<T> {
  bounds: Rect;
  depth: number;
  items: SpatialEntry<T>[];
  children: QuadNode<T>[] | null;
}

const DEFAULT_CAPACITY = 8;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_BOUNDS: Rect = { x: -4096, y: -4096, width: 8192, height: 8192 };

function nodeBounds(bounds: Rect): Rect {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function quadrantIndex(node: { readonly bounds: Rect }, bounds: Rect): number | null {
  const centerX = node.bounds.x + node.bounds.width / 2;
  const centerY = node.bounds.y + node.bounds.height / 2;
  const left = bounds.x + bounds.width <= centerX;
  const right = bounds.x >= centerX;
  const top = bounds.y + bounds.height <= centerY;
  const bottom = bounds.y >= centerY;
  if (left && top) return 0;
  if (right && top) return 1;
  if (left && bottom) return 2;
  if (right && bottom) return 3;
  return null;
}

function subdivide<T>(node: QuadNode<T>): QuadNode<T>[] {
  const halfWidth = node.bounds.width / 2;
  const halfHeight = node.bounds.height / 2;
  const { x, y } = node.bounds;
  const depth = node.depth + 1;
  node.children = [
    { bounds: { x, y, width: halfWidth, height: halfHeight }, depth, items: [], children: null },
    {
      bounds: { x: x + halfWidth, y, width: halfWidth, height: halfHeight },
      depth,
      items: [],
      children: null,
    },
    {
      bounds: { x, y: y + halfHeight, width: halfWidth, height: halfHeight },
      depth,
      items: [],
      children: null,
    },
    {
      bounds: { x: x + halfWidth, y: y + halfHeight, width: halfWidth, height: halfHeight },
      depth,
      items: [],
      children: null,
    },
  ];
  const retained: SpatialEntry<T>[] = [];
  for (const item of node.items) {
    const index = quadrantIndex(node, item.bounds);
    const child = index === null ? undefined : node.children[index];
    if (child) child.items.push(item);
    else retained.push(item);
  }
  node.items = retained;
  return node.children;
}

/**
 * Dependency-free quadtree over instance bounds. It is a culling aid, not a
 * source of truth: entries are keyed by scene instance key and upsert replaces.
 */
export class SpatialIndex<T> {
  private readonly byId = new Map<string, SpatialEntry<T>>();
  private readonly capacity: number;
  private readonly maxDepth: number;
  private readonly initialBounds: Rect;
  private root: QuadNode<T>;

  constructor(options: SpatialIndexOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH);
    this.initialBounds = options.bounds ?? DEFAULT_BOUNDS;
    this.root = this.createRoot(this.initialBounds);
  }

  get size(): number {
    return this.byId.size;
  }

  get bounds(): Rect {
    return this.root.bounds;
  }

  private createRoot(bounds: Rect): QuadNode<T> {
    const safe: Rect =
      bounds.width > 0 && bounds.height > 0
        ? nodeBounds(bounds)
        : { x: bounds.x, y: bounds.y, width: 1, height: 1 };
    return { bounds: safe, depth: 0, items: [], children: null };
  }

  private rebuild(extra?: Rect): void {
    let union: Rect | null = extra ? nodeBounds(extra) : null;
    for (const entry of this.byId.values()) {
      if (!union) {
        union = nodeBounds(entry.bounds);
        continue;
      }
      const x = Math.min(union.x, entry.bounds.x);
      const y = Math.min(union.y, entry.bounds.y);
      union = {
        x,
        y,
        width: Math.max(union.x + union.width, entry.bounds.x + entry.bounds.width) - x,
        height: Math.max(union.y + union.height, entry.bounds.y + entry.bounds.height) - y,
      };
    }
    const base = union ?? DEFAULT_BOUNDS;
    const margin = Math.max(1, Math.max(base.width, base.height) * 0.05);
    this.root = this.createRoot({
      x: base.x - margin,
      y: base.y - margin,
      width: base.width + margin * 2,
      height: base.height + margin * 2,
    });
    for (const entry of this.byId.values()) this.insert(this.root, entry);
  }

  private insert(node: QuadNode<T>, entry: SpatialEntry<T>): void {
    if (node.children) {
      const index = quadrantIndex(node, entry.bounds);
      const child = index === null ? undefined : node.children[index];
      if (child) {
        this.insert(child, entry);
        return;
      }
    }
    node.items.push(entry);
    if (!node.children && node.items.length > this.capacity && node.depth < this.maxDepth) {
      for (const child of subdivide(node)) this.maybeSubdivide(child);
    }
  }

  private maybeSubdivide(node: QuadNode<T>): void {
    if (node.children || node.items.length <= this.capacity || node.depth >= this.maxDepth) return;
    for (const child of subdivide(node)) this.maybeSubdivide(child);
  }

  upsert(id: string, bounds: Rect, value: T): void {
    this.remove(id);
    const entry: SpatialEntry<T> = { id, bounds: nodeBounds(bounds), value };
    this.byId.set(id, entry);
    if (!rectContainsRect(this.root.bounds, entry.bounds, 1e-6)) {
      this.rebuild(entry.bounds);
      return;
    }
    this.insert(this.root, entry);
  }

  remove(id: string): boolean {
    const entry = this.byId.get(id);
    if (!entry) return false;
    this.byId.delete(id);
    this.removeFrom(this.root, entry);
    return true;
  }

  private removeFrom(node: QuadNode<T>, entry: SpatialEntry<T>): void {
    if (!rectIntersects(node.bounds, entry.bounds, -1e-6)) return;
    const index = node.items.indexOf(entry);
    if (index >= 0) {
      node.items.splice(index, 1);
      return;
    }
    for (const child of node.children ?? []) this.removeFrom(child, entry);
  }

  search(area: Rect): readonly SpatialEntry<T>[] {
    const found: SpatialEntry<T>[] = [];
    const visit = (node: QuadNode<T>) => {
      if (!rectIntersects(node.bounds, area, -1e-6)) return;
      for (const item of node.items) {
        if (rectIntersects(item.bounds, area, -1e-6)) found.push(item);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(this.root);
    return found;
  }

  searchPoint(x: number, y: number, tolerance = 0): readonly SpatialEntry<T>[] {
    return this.search({
      x: x - tolerance,
      y: y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2,
    });
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): SpatialEntry<T> | undefined {
    return this.byId.get(id);
  }

  entries(): readonly SpatialEntry<T>[] {
    return [...this.byId.values()];
  }

  clear(): void {
    this.byId.clear();
    this.root = this.createRoot(this.initialBounds);
  }
}

/** Build an index from already-derived instance boxes. */
export function spatialIndexFrom<T>(
  entries: readonly SpatialEntry<T>[],
  options: SpatialIndexOptions = {},
): SpatialIndex<T> {
  const index = new SpatialIndex<T>(options);
  for (const entry of entries) index.upsert(entry.id, entry.bounds, entry.value);
  return index;
}
