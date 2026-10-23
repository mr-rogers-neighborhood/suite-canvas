/**
 * Boot timings separate the fixed startup floor from document-size costs.
 *
 * The numbers worth reading are:
 * - `hydrate`: IndexedDB open + snapshot/update import (the local-first floor);
 * - `to-ready`: module load → the first editable shell;
 * - `to-synced`: module load → the first server sync (never gates the skeleton).
 *
 * Marking is a no-op outside a browser, so tests and the server bundle do not
 * need a performance shim.
 */
const ENABLED = typeof performance !== "undefined" && typeof performance.mark === "function";

const marks = new Map<string, number>();
const durations = new Map<string, number>();

export interface BootTiming {
  name: string;
  durationMs: number;
}

export function markBoot(name: string): void {
  if (!ENABLED) return;
  marks.set(name, performance.now());
  try {
    performance.mark(`suite:${name}`);
  } catch {
    // A browser that rejects a duplicate mark must not break the boot.
  }
}

export function measureBoot(name: string, start: string, end: string): number | null {
  if (!ENABLED) return null;
  const from = marks.get(start);
  const to = marks.get(end);
  if (from === undefined || to === undefined) return null;
  const duration = Math.max(0, to - from);
  durations.set(name, duration);
  try {
    performance.measure(`suite:boot:${name}`, `suite:${start}`, `suite:${end}`);
  } catch {
    // The map above is the source of truth; the entry is for devtools only.
  }
  return duration;
}

export function readBootTimings(): BootTiming[] {
  return [...durations.entries()]
    .map(([name, durationMs]) => ({ name, durationMs }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Test seam: marks and durations are module state. */
export function resetBootTimings(): void {
  marks.clear();
  durations.clear();
}
