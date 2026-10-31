/**
 * Reading an EPUB's package: what the book is, what it holds, and what order to read it in.
 *
 * An EPUB is a zip with three facts inside it. `META-INF/container.xml` names the package document; the
 * package (an OPF file) lists the manifest and the spine; and a navigation document or an NCX names the
 * chapters in the words the book uses. Everything else — the chapters themselves — is read later, one at a
 * time, because a book is hundreds of kilobytes of markup and a reader who opens the contents should not pay
 * for all of it.
 *
 * Pure: bytes in, a description out. The parsing uses `DOMParser`, which the tests run under happy-dom, and
 * nothing here fetches, renders or stores.
 */

/** One file the package's manifest declares. */
export interface EpubManifestItem {
  readonly id: string;
  /** The path inside the archive, already resolved against the package's own directory. */
  readonly path: string;
  readonly mediaType: string;
  /** The package's own properties: `nav` marks the navigation document, `cover-image` the cover. */
  readonly properties: readonly string[];
}

/** One chapter, in reading order. */
export interface EpubSpineItem {
  readonly index: number;
  readonly idref: string;
  readonly path: string;
  readonly mediaType: string;
  /** `linear="no"` marks a page a reader is not expected to read through, like a colophon or a cover. */
  readonly linear: boolean;
}

/** One entry in the table of contents, flattened with a depth so a renderer can indent it. */
export interface EpubTocEntry {
  readonly label: string;
  /** The archive path the entry points at, or null when the book names a place its own nav cannot resolve. */
  readonly path: string | null;
  /** The fragment within that document, when the entry points at a place rather than a file. */
  readonly fragment: string | null;
  readonly depth: number;
}

/** What the package says the book is. */
export interface EpubPackage {
  /** The package document's own path, which every other path is resolved against. */
  readonly packagePath: string;
  readonly title: string;
  readonly creator: string | null;
  readonly language: string | null;
  /** The book's unique identifier, when it carries one. */
  readonly identifier: string | null;
  readonly manifest: readonly EpubManifestItem[];
  readonly spine: readonly EpubSpineItem[];
  readonly toc: readonly EpubTocEntry[];
  /** The cover image's path, when the package declares one. */
  readonly coverPath: string | null;
  /** True when the book asks for a fixed page size, which is a page image and not reflowable text. */
  readonly fixedLayout: boolean;
  /** What the book declares it needs in order to render, when it says so. */
  readonly rights: string | null;
}

export class EpubError extends Error {}

const decoder = new TextDecoder();

function parseXml(text: string): Document {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror") !== null) {
    throw new EpubError("this book's package is not readable XML");
  }
  return document;
}

/** Every element with one local name, whatever namespace prefix the book chose. */
function byLocalName(root: Document | Element, name: string): Element[] {
  return [...root.getElementsByTagName("*")].filter(
    (element) => element.localName === name || element.tagName === name,
  );
}

function textOf(element: Element | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * Resolve a path the package writes against the directory the package document sits in.
 *
 * A book may spell its paths either way — `chapter1.xhtml` beside the package or `text/chapter1.xhtml` from
 * the archive root — and both mean the same file. Resolving here means every path this module returns is an
 * archive path, so callers never repeat the arithmetic.
 */
export function resolvePath(packagePath: string, href: string): string {
  const clean = decodeHref(href);
  if (clean.startsWith("/")) return clean.slice(1);
  const base = packagePath.includes("/") ? packagePath.slice(0, packagePath.lastIndexOf("/")) : "";
  return base.length === 0 ? clean : `${base}/${clean}`;
}

/** A manifest href, minus its fragment and its percent escapes. */
function decodeHref(href: string): string {
  const withoutFragment = href.split("#")[0] ?? "";
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    // A book that percent-encodes wrongly still names a file; reading it as written beats refusing the book.
    return withoutFragment;
  }
}

/** The fragment an href names, or null. */
function fragmentOf(href: string): string | null {
  const at = href.indexOf("#");
  return at === -1 ? null : href.slice(at + 1);
}

/** The package document's path, from `META-INF/container.xml`. */
export function packagePathOf(containerXml: string): string {
  const document = parseXml(containerXml);
  const rootfile = byLocalName(document, "rootfile")[0];
  const path = rootfile?.getAttribute("full-path") ?? "";
  if (path.length === 0) throw new EpubError("this book does not say which file describes it");
  return path;
}

/** One OPF package document, read into the facts a reader needs before it renders anything. */
export function parsePackage(packagePath: string, xml: string): EpubPackage {
  const document = parseXml(xml);
  const metadata = byLocalName(document, "metadata")[0];

  const title = textOf(byLocalName(metadata ?? document, "title")[0]) || "Untitled book";
  const creator = textOf(byLocalName(metadata ?? document, "creator")[0]) || null;
  const language = textOf(byLocalName(metadata ?? document, "language")[0]) || null;
  const identifier =
    textOf(byLocalName(metadata ?? document, "identifier")[0]) ||
    textOf(byLocalName(metadata ?? document, "uuid")[0]) ||
    null;

  const manifest: EpubManifestItem[] = [];
  const byId = new Map<string, EpubManifestItem>();
  for (const item of byLocalName(document, "item")) {
    const id = item.getAttribute("id") ?? "";
    const href = item.getAttribute("href") ?? "";
    if (id.length === 0 || href.length === 0) continue;
    const entry: EpubManifestItem = {
      id,
      path: resolvePath(packagePath, href),
      mediaType: item.getAttribute("media-type") ?? "",
      properties: (item.getAttribute("properties") ?? "").split(/\s+/u).filter(Boolean),
    };
    manifest.push(entry);
    byId.set(id, entry);
  }

  const spine: EpubSpineItem[] = [];
  for (const itemref of byLocalName(document, "itemref")) {
    const idref = itemref.getAttribute("idref") ?? "";
    const item = byId.get(idref);
    if (item === undefined) continue;
    spine.push({
      index: spine.length,
      idref,
      path: item.path,
      mediaType: item.mediaType,
      linear: itemref.getAttribute("linear") !== "no",
    });
  }

  if (spine.length === 0) throw new EpubError("this book has no chapters in its spine");

  const coverPath =
    [...byId.values()].find(
      (item) =>
        item.properties.includes("cover-image") ||
        // EPUB 2 names the cover through a meta element instead: `<meta name="cover" content="id"/>`.
        byLocalName(metadata ?? document, "meta").some(
          (meta) =>
            meta.getAttribute("name") === "cover" && meta.getAttribute("content") === item.id,
        ),
    )?.path ?? null;

  const rights = textOf(byLocalName(metadata ?? document, "rights")[0]) || null;

  return {
    packagePath,
    title,
    creator,
    language,
    identifier,
    manifest,
    spine,
    toc: [],
    coverPath,
    fixedLayout: fixedLayoutFrom(metadata ?? null),
    rights,
  };
}

/** A `rendition:layout` of `pre-paginated`, or a spine that names one item per page of an image. */
function fixedLayoutFrom(metadata: Element | null): boolean {
  const metas = metadata === null ? [] : byLocalName(metadata, "meta");
  const rendition = metas.find((meta) =>
    `${meta.getAttribute("property") ?? meta.getAttribute("name") ?? ""}`.endsWith(
      "rendition:layout",
    ),
  );
  return textOf(rendition) === "pre-paginated";
}

/**
 * The table of contents, from the nav document the manifest marks `nav`, or from an NCX.
 *
 * EPUB 3 books carry a nav document; EPUB 2 books carry an NCX, and plenty of EPUB 3 books carry both. The
 * nav wins when it exists because it is the one the book's own publisher maintained most recently.
 */
export function parseToc(
  packagePath: string,
  navXhtml: string | null,
  ncxXml: string | null,
): EpubTocEntry[] {
  if (navXhtml !== null) {
    const fromNav = parseNav(packagePath, navXhtml);
    if (fromNav.length > 0) return fromNav;
  }
  if (ncxXml !== null) return parseNcx(packagePath, ncxXml);
  return [];
}

/** `nav[epub:type="toc"]`, or the first `nav` when the book does not say which one is the contents. */
function parseNav(packagePath: string, xhtml: string): EpubTocEntry[] {
  const document = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
  if (document.querySelector("parsererror") !== null) return [];
  const navs = byLocalName(document, "nav");
  const toc =
    navs.find((nav) =>
      (nav.getAttribute("epub:type") ?? nav.getAttribute("type") ?? "").includes("toc"),
    ) ??
    navs[0] ??
    document.body;
  if (toc === undefined || toc === null) return [];

  const entries: EpubTocEntry[] = [];
  const walk = (list: Element, depth: number): void => {
    for (const item of [...list.children]) {
      if (item.localName !== "li") continue;
      const anchor = [...item.children].find((child) => child.localName === "a");
      const nested = [...item.children].find(
        (child) => child.localName === "ol" || child.localName === "ul",
      );
      if (anchor !== undefined) {
        const href = anchor.getAttribute("href") ?? "";
        entries.push({
          label: textOf(anchor) || "(untitled)",
          path: href.length === 0 ? null : resolvePath(packagePath, href),
          fragment: fragmentOf(href),
          depth,
        });
      }
      if (nested !== undefined) walk(nested, depth + 1);
    }
  };

  const topList = [...(toc.children ?? [])].find(
    (child) => child.localName === "ol" || child.localName === "ul",
  );
  if (topList !== undefined) walk(topList, 0);
  return entries;
}

/** EPUB 2's `navPoints`, which nest by document order rather than by container. */
function parseNcx(packagePath: string, xml: string): EpubTocEntry[] {
  const document = parseXml(xml);
  const points = byLocalName(document, "navPoint");
  if (points.length === 0) return [];

  const depthOf = (point: Element): number => {
    let depth = 0;
    let parent = point.parentElement;
    while (parent !== null) {
      if (parent.localName === "navPoint") depth += 1;
      parent = parent.parentElement;
    }
    return depth;
  };

  return points.map((point) => {
    const label = textOf(byLocalName(point, "text")[0]) || "(untitled)";
    const source = byLocalName(point, "content")[0];
    const src = source?.getAttribute("src") ?? "";
    return {
      label,
      path: src.length === 0 ? null : resolvePath(packagePath, src),
      fragment: fragmentOf(src),
      depth: depthOf(point),
    };
  });
}

/** The nav document and NCX the package declares, by path, most specific first. */
export function tocSources(book: EpubPackage): { nav: string | null; ncx: string | null } {
  const nav = book.manifest.find((item) => item.properties.includes("nav"))?.path ?? null;
  const ncx =
    book.manifest.find((item) => item.mediaType === "application/x-dtbncx+xml")?.path ??
    // A package may name the NCX on the spine rather than in the manifest; both spellings are common.
    null;
  return { nav, ncx };
}

export { decoder as epubDecoder };
