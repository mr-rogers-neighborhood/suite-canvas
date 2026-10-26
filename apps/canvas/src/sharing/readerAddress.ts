/**
 * The reader route, as a pure function of a URL: a published page lives at
 * `/s/<slug>`, and the slug is the page's stable name.
 *
 * This module has no imports on purpose. `ShareUnavailable` is imported
 * statically by the shell, while the share client (`session/shares.ts`) is
 * loaded on demand in a relay build; both need the reader route, and only a
 * dependency-free module keeps the client out of a standalone bundle.
 */

/** Path prefix of the reader route. */
export const SHARE_READER_PREFIX = "/s";

/** `/s/<slug>`, the path half of a reader address. */
export function readerPath(slug: string): string {
  return `${SHARE_READER_PREFIX}/${encodeURIComponent(slug)}`;
}

/**
 * The slug in a reader address, or null when the URL is not one. Used to name
 * the page a reader could not open, which is the difference between "this page
 * was unpublished" and an empty canvas.
 */
export function readerSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://suite.invalid");
  } catch {
    return null;
  }
  const prefix = `${SHARE_READER_PREFIX}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;
  const raw = parsed.pathname.slice(prefix.length).replace(/\/+$/u, "");
  if (raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
