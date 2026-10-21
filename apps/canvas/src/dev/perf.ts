/**
 * Render counters for diagnosing collaboration cost: which components repaint
 * when a peer moves something. Enabled with `?perf=1` in development builds, so
 * an ordinary render only pays one boolean check.
 */
const ENABLED =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("perf");

const WINDOW_MS = 1000;
const timestamps = new Map<string, number[]>();

export const perfEnabled = ENABLED;

/** Records one render. Cheap no-op unless the overlay is enabled. */
export function countRender(key: string): void {
  if (!ENABLED) return;
  const now = performance.now();
  const stamps = timestamps.get(key);
  if (!stamps) {
    timestamps.set(key, [now]);
    return;
  }
  stamps.push(now);
  // Keep the buffer bounded if nobody is reading it.
  if (stamps.length > 512) stamps.splice(0, stamps.length - 512);
}

export interface RenderRate {
  key: string;
  perSecond: number;
}

function recent(stamps: number[], now: number): number[] {
  let index = stamps.length;
  while (index > 0 && now - (stamps[index - 1] as number) <= WINDOW_MS) index -= 1;
  if (index > 0) stamps.splice(0, index);
  return stamps;
}

/** Renders per second per key over the last second. */
export function readRenderRates(): RenderRate[] {
  if (!ENABLED) return [];
  const now = performance.now();
  return [...timestamps.entries()]
    .map(([key, stamps]) => ({ key, perSecond: recent(stamps, now).length }))
    .sort((a, b) => b.perSecond - a.perSecond || a.key.localeCompare(b.key));
}
