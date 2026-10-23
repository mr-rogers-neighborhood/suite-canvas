/**
 * Surface routing for the single-engine canvas.
 *
 * Every workspace opens on ICE. The old `?canvas=flow` and `?canvas=scene`
 * values are not honoured any more, because React Flow is gone; a bookmarked
 * link is redirected to the same workspace on ICE rather than failing.
 *
 * Navigation only: no part of this module reads or writes a document.
 */

/** The one surface the app serves. */
export const ICE_SURFACE = "ice";

/** Values that used to select another engine. */
export const LEGACY_SURFACES = ["flow", "scene"] as const;
export type LegacySurface = (typeof LEGACY_SURFACES)[number];

export interface ParsedHref {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

function parse(href: string): ParsedHref | null {
  try {
    const url = new URL(href, "http://suite.invalid");
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  } catch {
    return null;
  }
}

function format(parts: ParsedHref): string {
  return `${parts.pathname}${parts.search}${parts.hash}`;
}

/**
 * The same page with `canvas=ice`. Every other parameter and the hash survive,
 * including `workspace`, `board`, `share` and the owner fragment.
 */
export function iceUrlFor(href: string): string {
  const parts = parse(href);
  if (parts === null) return href;
  const url = new URL(`${parts.pathname}${parts.search}`, "http://suite.invalid");
  url.searchParams.set("canvas", ICE_SURFACE);
  return format({ pathname: url.pathname, search: url.search, hash: parts.hash });
}

/** The `canvas` value a URL asks for, or `null` when it asks for none. */
export function requestedSurface(href: string): string | null {
  const parts = parse(href);
  if (parts === null) return null;
  return new URLSearchParams(parts.search).get("canvas");
}

/**
 * Where this URL should actually go: a legacy `flow`/`scene` link becomes the
 * ICE page with the same workspace and fragment. Everything else returns
 * `null`, meaning "serve this page as it is".
 */
export function legacyCanvasRedirect(href: string): string | null {
  const surface = requestedSurface(href);
  if (surface === null) return null;
  if (!(LEGACY_SURFACES as readonly string[]).includes(surface)) return null;
  if (surface === ICE_SURFACE) return null;
  return iceUrlFor(href);
}

/** The URL a fresh workspace opens on. */
export function workspaceUrl(workspaceId: string): string {
  return `/ ?workspace=${workspaceId}&canvas=${ICE_SURFACE}`.replace("/ ?", "/?");
}
