import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The bundled icon sets, resolved from a reference like `lucide:check`.
 *
 * Lucide ships with the app rather than being fetched: a board full of icons has
 * to draw on a plane, in a share opened by someone who has never signed in, and
 * on the first frame rather than after a round trip. Anything outside these sets
 * arrives through the picker's "Add more icon sets", cached on the device — no
 * icon ever passes through our servers.
 */
export interface IconBody {
  /** The set's own inner SVG markup. */
  body: string;
  width: number;
  height: number;
}

interface IconifySet {
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
}

/** Every set this build ships. A key is the prefix a reference names. */
const BUNDLED: Record<string, () => Promise<IconifySet>> = {
  lucide: async () => (await import("@iconify-json/lucide/icons.json")).default as IconifySet,
};

/** The prefixes a picker can offer with no network at all. */
export const bundledPrefixes = Object.keys(BUNDLED);

const cache = new Map<string, IconifySet>();

/**
 * A counter rather than a store of icons: a glyph only needs to know that the cache
 * moved, and asking `iconBody` again is cheaper than diffing what arrived.
 *
 * Without this a card drew its icon on the visit that picked it and lost it on the next
 * load: the reference was in the document, the set was not in memory yet, and nothing
 * told the glyph to draw again once it was.
 */
let generation = 0;
const listeners = new Set<() => void>();

function announce(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

function subscribeToIconSets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function iconSetGeneration(): number {
  return generation;
}

async function loadSet(prefix: string): Promise<IconifySet | null> {
  const cached = cache.get(prefix);
  if (cached) return cached;
  const load = BUNDLED[prefix];
  if (!load) return null;
  try {
    const set = await load();
    cache.set(prefix, set);
    announce();
    return set;
  } catch {
    // A set that cannot be read is a missing icon, not a failed render.
    return null;
  }
}

/** Warms a set so a card draws on its first frame rather than its second. */
export async function preloadIconSet(prefix: string): Promise<void> {
  await loadSet(prefix);
}

/**
 * The names in one set, once it has loaded.
 *
 * The picker needs a list to scroll and the canvas needs a body to draw, and
 * neither can await per icon: the set loads once, then everything reads the
 * cache synchronously.
 */
export function useIconSet(prefix: string): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  useEffect(() => {
    let live = true;
    void loadSet(prefix).then((set) => {
      if (!live || set === null) return;
      setNames(Object.keys(set.icons));
    });
    return () => {
      live = false;
    };
  }, [prefix]);
  return names;
}

/** The drawing for one reference, or null when the set or the name is missing. */
export function iconBody(ref: string | null | undefined): IconBody | null {
  if (!ref) return null;
  const at = ref.indexOf(":");
  if (at <= 0) return null;
  const set = cache.get(ref.slice(0, at));
  const icon = set?.icons[ref.slice(at + 1)];
  if (!icon) return null;
  return {
    body: icon.body,
    width: icon.width ?? set?.width ?? 24,
    height: icon.height ?? set?.height ?? 24,
  };
}

/** The prefix a reference names, or null when it is not one (`"check"`, `""`). */
function prefixOf(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const at = ref.indexOf(":");
  return at > 0 ? ref.slice(0, at) : null;
}

/**
 * One icon, and a repaint when its set arrives.
 *
 * `iconBody` is synchronous and reads what is in memory, so on a cold page load it
 * answers null for a reference the document really has. This asks for the set when the
 * glyph mounts and re-renders when it lands, which is what makes an icon survive a
 * reload without anyone reopening the picker.
 */
export function useIconBody(ref: string | null | undefined): IconBody | null {
  // Subscribing to the counter is the whole point: it is the only thing that changes
  // when a set arrives, and `getSnapshot` above it is the cache read.
  useSyncExternalStore(subscribeToIconSets, iconSetGeneration, () => 0);
  const prefix = prefixOf(ref);
  useEffect(() => {
    if (prefix !== null && !cache.has(prefix)) void loadSet(prefix);
  }, [prefix]);
  return iconBody(ref);
}

/**
 * Loads every set a document needs, ahead of the glyphs.
 *
 * A glyph asks for its own set on mount, which costs one frame of empty header. Asking
 * up front means the first paint after a reload already has the icons on the board.
 */
export function preloadIconRefs(refs: readonly (string | null | undefined)[]): void {
  const wanted = new Set<string>();
  for (const ref of refs) {
    const prefix = prefixOf(ref);
    if (prefix !== null && !cache.has(prefix)) wanted.add(prefix);
  }
  for (const prefix of wanted) void loadSet(prefix);
}

/**
 * Loads every set the given references need, then reports ready.
 *
 * A card renders before the set has arrived, so it draws its fallback for a
 * frame. Asking for the sets up front (the workspace's types, the cards on
 * screen) keeps that to the first paint instead of every paint.
 */
export function useIconSetsReady(refs: readonly string[]): boolean {
  const prefixes: string[] = [];
  for (const ref of refs) {
    const at = ref.indexOf(":");
    if (at <= 0) continue;
    const prefix = ref.slice(0, at);
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }

  const key = prefixes.join(",");
  const [ready, setReady] = useState(() => key === "");
  // `key` is the identity: it changes exactly when the set of prefixes does, and
  // the closure reads the same list it was built from.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(() => {
    if (key === "") {
      setReady(true);
      return;
    }
    let live = true;
    void Promise.all(prefixes.map((prefix) => preloadIconSet(prefix))).then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return ready;
}
