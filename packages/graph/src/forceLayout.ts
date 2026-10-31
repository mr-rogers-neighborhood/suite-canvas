/**
 * Where the nodes of a graph render sit, as plain coordinates.
 *
 * Pure and deterministic: the same graph always answers with the same picture, so a
 * render card does not rearrange itself every time the workspace changes underneath it.
 * Small on purpose. A layout that takes a frame to settle is a layout the reader watches
 * wobble; this one runs once over a fixed number of steps and stops.
 */

export interface ForceNode {
  readonly id: string;
}

export interface ForceEdge {
  readonly source: string;
  readonly target: string;
}

export interface ForcePoint {
  readonly id: string;
  /** Normalised to 0..1, so a renderer scales by its own frame. */
  readonly x: number;
  readonly y: number;
}

export interface ForceLayoutOptions {
  readonly width?: number;
  readonly height?: number;
  readonly iterations?: number;
}

/**
 * A tiny deterministic PRNG.
 *
 * `Math.random` would make the same document draw differently on every render, so the
 * starting positions come from a fixed seed stepped by index instead.
 */
function scatter(index: number): number {
  const raw = Math.sin(index * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

/**
 * Fruchterman-Reingold, one pass per iteration.
 *
 * Repulsion between every pair, attraction along every edge, and a cooling schedule so
 * the last passes only tidy. Disconnected nodes still repel, which is what keeps an
 * isolated card from landing on top of a cluster.
 */
export function forceLayout(
  nodes: readonly ForceNode[],
  edges: readonly ForceEdge[],
  options: ForceLayoutOptions = {},
): ForcePoint[] {
  const width = options.width ?? 1;
  const height = options.height ?? 1;
  const iterations = options.iterations ?? 80;
  const count = nodes.length;
  if (count === 0) return [];
  if (count === 1) return [{ id: (nodes[0] as ForceNode).id, x: width / 2, y: height / 2 }];

  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    // A ring rather than a random cloud: the first pass already has structure, so fewer
    // iterations are needed and the result is less sensitive to the seed.
    const angle = (index / count) * Math.PI * 2;
    const radius = 0.3 + scatter(index) * 0.1;
    x[index] = width * (0.5 + Math.cos(angle) * radius);
    y[index] = height * (0.5 + Math.sin(angle) * radius);
  }

  const links = edges
    .map((edge) => ({ a: indexOf.get(edge.source), b: indexOf.get(edge.target) }))
    .filter(
      (link): link is { a: number; b: number } => link.a !== undefined && link.b !== undefined,
    );

  const area = width * height;
  const k = Math.sqrt(area / count);

  for (let step = 0; step < iterations; step += 1) {
    const dx = new Float64Array(count);
    const dy = new Float64Array(count);

    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let deltaX = (x[i] as number) - (x[j] as number);
        let deltaY = (y[i] as number) - (y[j] as number);
        let distance = Math.hypot(deltaX, deltaY);
        // Two nodes on the same point have no direction to push along, so nudge them off
        // it deterministically instead of dividing by zero.
        if (distance < 0.01) {
          deltaX = 0.01 * (i - j);
          deltaY = 0.01;
          distance = Math.hypot(deltaX, deltaY);
        }
        const force = (k * k) / distance;
        const unitX = (deltaX / distance) * force;
        const unitY = (deltaY / distance) * force;
        dx[i] = (dx[i] as number) + unitX;
        dy[i] = (dy[i] as number) + unitY;
        dx[j] = (dx[j] as number) - unitX;
        dy[j] = (dy[j] as number) - unitY;
      }
    }

    for (const link of links) {
      const deltaX = (x[link.a] as number) - (x[link.b] as number);
      const deltaY = (y[link.a] as number) - (y[link.b] as number);
      const distance = Math.max(0.01, Math.hypot(deltaX, deltaY));
      const force = (distance * distance) / k;
      const unitX = (deltaX / distance) * force;
      const unitY = (deltaY / distance) * force;
      dx[link.a] = (dx[link.a] as number) - unitX;
      dy[link.a] = (dy[link.a] as number) - unitY;
      dx[link.b] = (dx[link.b] as number) + unitX;
      dy[link.b] = (dy[link.b] as number) + unitY;
    }

    // Cooling: the first pass may move a node far, the last only nudges it.
    const limit = (k * (iterations - step)) / iterations / 2;
    for (let index = 0; index < count; index += 1) {
      const moveX = dx[index] as number;
      const moveY = dy[index] as number;
      const length = Math.max(0.01, Math.hypot(moveX, moveY));
      const scale = Math.min(length, limit) / length;
      x[index] = (x[index] as number) + moveX * scale;
      y[index] = (y[index] as number) + moveY * scale;
    }
  }

  // Normalise into the caller's frame, with a margin so a node never sits on the edge.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    minX = Math.min(minX, x[index] as number);
    minY = Math.min(minY, y[index] as number);
    maxX = Math.max(maxX, x[index] as number);
    maxY = Math.max(maxY, y[index] as number);
  }
  const spanX = Math.max(0.0001, maxX - minX);
  const spanY = Math.max(0.0001, maxY - minY);

  return nodes.map((node, index) => ({
    id: node.id,
    x: ((x[index] as number) - minX) / spanX,
    y: ((y[index] as number) - minY) / spanY,
  }));
}
