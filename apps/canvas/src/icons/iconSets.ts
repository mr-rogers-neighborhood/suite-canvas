import { useEffect, useState } from "react";

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

async function loadSet(prefix: string): Promise<IconifySet | null> {
  const cached = cache.get(prefix);
  if (cached) return cached;
  const load = BUNDLED[prefix];
  if (!load) return null;
  try {
    const set = await load();
    cache.set(prefix, set);
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
