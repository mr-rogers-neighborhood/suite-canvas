/**
 * The pictures inside a chapter, and the object URLs that make them show.
 *
 * A book's images are files inside the same zip, and the sanitiser rewrites a chapter's `src` into the archive path
 * they live at — never a URL, because nothing in this app is fetched at render time. So a picture is a lookup: the
 * path is already in the markup, and the bytes are in the archive the reader has open.
 *
 * The two halves are deliberately separate. `imagePaths` reads the markup, so it is pure and testable without a book;
 * `resolveImages` swaps the paths a loader managed to serve, so a picture the archive cannot produce keeps its `alt`
 * text and an empty `src` rather than a broken box.
 */

/** The picture formats a book may reasonably hold, by extension. SVG is here because a cover often is one. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** The MIME type for an archive path, or `application/octet-stream` when the extension says nothing. */
export function imageMime(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const extension = withoutQuery.slice(withoutQuery.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Whether a chapter's `src` is a path inside the book rather than something already usable.
 *
 * `data:` images are left exactly as they are: they are in the document already, so nothing needs loading. An `http`
 * address never reaches here — the sanitiser dropped it and reported it.
 */
function isArchivePath(src: string): boolean {
  return src.length > 0 && !src.startsWith("data:") && !/^[a-z][a-z0-9+.-]*:/iu.test(src);
}

/**
 * Every archive path a chapter's markup points a picture at, once each and in document order.
 *
 * Pure: a string in, paths out. `DOMParser` is available in the tests through happy-dom, and the markup is the
 * sanitiser's own output, so parsing it is not a second injection site.
 */
export function imagePaths(html: string): string[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const found: string[] = [];
  for (const image of document.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src") ?? "";
    if (!isArchivePath(src) || found.includes(src)) continue;
    found.push(src);
  }
  return found;
}

/**
 * The chapter with its pictures pointed at the URLs that were loaded.
 *
 * A path with no URL is written as an empty `src` so the browser draws nothing rather than requesting the path against
 * the app's own origin — which is what a 404 in the reader used to be. The `alt` text stays, so the words a picture
 * stood for are still on the page.
 */
export function resolveImages(html: string, assets: ReadonlyMap<string, string>): string {
  if (assets.size === 0) return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const image of document.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src") ?? "";
    if (!isArchivePath(src)) continue;
    const url = assets.get(src);
    image.setAttribute("src", url ?? "");
    if (url === undefined) image.setAttribute("data-missing-image", src);
  }
  return document.body.innerHTML;
}
