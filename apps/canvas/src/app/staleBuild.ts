/**
 * Whether this tab is running the build the server would hand out now.
 *
 * A canvas tab stays open for days, and a deploy does not reach a document already
 * on screen: the old bundle keeps running, so a fix that shipped reads as a bug that
 * survived. Both sides are named by the entry chunk Vite content-hashes, which is
 * the one file name that changes with every build.
 *
 * Pure and DOM-free apart from `loadedEntry`, which reads the entry `<script>` this
 * page was started from — the launcher and the canvas share it.
 */

/** The hashed entry chunk in a built `index.html`, or null when there is none. */
export function entryBundleOf(html: string): string | null {
  return /\/assets\/main-[A-Za-z0-9_-]+\.js/.exec(html)?.[0] ?? null;
}

/** The same name as this page loaded it, or null in dev and under a plain `index`. */
export function loadedEntry(doc: Document = document): string | null {
  const script = doc.querySelector('script[type="module"][src]');
  const src = script?.getAttribute("src");
  return src ? entryBundleOf(src) : null;
}

/**
 * True only when both names are known and they differ. A dev server serves the
 * entry from `/src`, and an unknown name means "cannot tell", which must never
 * paint a reload prompt over a document the reader is working in.
 */
export function isStaleBuild(loaded: string | null, served: string | null): boolean {
  if (loaded === null || served === null) return false;
  return loaded !== served;
}
