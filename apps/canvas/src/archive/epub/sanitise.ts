/**
 * Turning a book's chapter markup into markup we are willing to put in our own document.
 *
 * A book is untrusted input. It is HTML with namespaced extensions, it may carry script, it may point at
 * things on the network, and it may bring a stylesheet that fights ours and can `@import` a remote font. The
 * app's rule is that nothing is fetched at render time and no remote page is hosted, so the sanitiser is
 * where a book becomes ours.
 *
 * The output is a string of our own allowed markup, because that is the one shape both renderers agree on: the
 * reader draws it, and the `explore` text index reads it. Every refusal is **named** in the returned report
 * rather than silently dropped, so a chapter that lost its images can say so.
 *
 * Pure: a string in, a string and a report out. No DOM is mounted, nothing is fetched.
 */

/** Elements we keep. Everything else is unwrapped (children kept) or dropped, by the lists below. */
const ALLOWED_ELEMENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "div",
  "span",
  "br",
  "hr",
  "em",
  "strong",
  "i",
  "b",
  "u",
  "s",
  "sub",
  "sup",
  "small",
  "mark",
  "cite",
  "q",
  "dfn",
  "abbr",
  "blockquote",
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  "figure",
  "figcaption",
  "img",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "hgroup",
  "address",
  "a",
  "ruby",
  "rt",
  "rp",
  "bdi",
  "bdo",
  "wbr",
  "time",
]);

/** Elements dropped with their whole subtree: they run code, fetch, or hold a second document. */
const DROPPED_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "svg",
  "math",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "link",
  "meta",
  "base",
  "noscript",
  "template",
  "portal",
  "frame",
  "frameset",
]);

/** Attributes kept, by element. Everything else goes, including every `on*`. */
const ALLOWED_ATTRIBUTES = new Set([
  "id",
  "class",
  "title",
  "lang",
  "dir",
  "alt",
  "colspan",
  "rowspan",
  "scope",
  "start",
  "reversed",
  "value",
  "datetime",
  "cite",
  "abbr",
]);

/** What a sanitised chapter reports about what it could not keep. */
export interface SanitiseReport {
  /** Elements dropped whole, with their tag names, so a reader can be told what the chapter lost. */
  readonly dropped: readonly string[];
  /** Remote resources the chapter referenced and we refused to fetch. */
  readonly remote: readonly string[];
  /** Links rewritten into reader navigation, so a footnote press lands somewhere. */
  readonly links: number;
  /** True when the chapter had an element we removed for being able to run code. */
  readonly hadScript: boolean;
}

export interface SanitisedChapter {
  /** Our allowed markup, ready to render. */
  readonly html: string;
  readonly report: SanitiseReport;
}

/**
 * A book's chapter, sanitised.
 *
 * `basePath` is the chapter's own path in the archive, which is what a relative link resolves against: a
 * footnote in `text/chapter1.xhtml` that points at `notes.xhtml` means `text/notes.xhtml`.
 *
 * Relative image paths are left alone in the markup — the reader resolves them against the chapter and serves
 * them from the archive — while absolute `http(s)` addresses are refused, because fetching one at render time
 * would tell a third party when and what somebody is reading.
 */
export function sanitiseChapter(xml: string, basePath: string): SanitisedChapter {
  // Parsed the forgiving way on purpose. A book is HTML with a well-formedness *promise*: plenty break it in
  // small ways, and refusing a chapter over an unclosed `<br>` would cost a reader their page. Strictness
  // buys nothing here because nothing from the parse is trusted — the walk below rebuilds every element.
  const source = new DOMParser().parseFromString(xml, "text/html").body;
  if (source === null)
    return { html: "", report: { dropped: [], remote: [], links: 0, hadScript: false } };

  const dropped = new Set<string>();
  const remote = new Set<string>();
  let links = 0;
  let hadScript = false;

  const walk = (node: Node, into: Element): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text.length > 0) into.append(document.createTextNode(text));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      const name = element.localName.toLowerCase();

      if (DROPPED_ELEMENTS.has(name)) {
        dropped.add(name);
        if (name === "script" || name === "iframe" || name === "object") hadScript = true;
        continue;
      }
      if (!ALLOWED_ELEMENTS.has(name)) {
        // An unknown wrapper (an epub:switch, a book's own div soup) is unwrapped rather than lost: its
        // children are the chapter.
        walk(element, into);
        continue;
      }

      const replacement = document.createElement(name);
      for (const attribute of [...element.attributes]) {
        const key = attribute.name.toLowerCase();
        if (key.includes(":")) continue;
        if (!ALLOWED_ATTRIBUTES.has(key)) continue;
        replacement.setAttribute(key, attribute.value);
      }

      if (name === "img") {
        const src = resolveResource(element.getAttribute("src") ?? "", basePath);
        if (src === null) {
          remote.add(element.getAttribute("src") ?? "");
          continue;
        }
        replacement.setAttribute("src", src);
        if (!replacement.hasAttribute("alt")) replacement.setAttribute("alt", "");
        into.append(replacement);
        continue;
      }

      if (name === "a") {
        const rewritten = rewriteLink(element.getAttribute("href") ?? "", basePath);
        if (rewritten !== null) {
          replacement.setAttribute("href", rewritten);
          links += 1;
        }
        walk(element, replacement);
        into.append(replacement);
        continue;
      }

      walk(element, replacement);
      into.append(replacement);
    }
  };

  const root = document.createElement("div");
  walk(source, root);

  return {
    html: root.innerHTML,
    report: {
      dropped: [...dropped].sort(),
      remote: [...remote].sort(),
      links,
      hadScript,
    },
  };
}

/**
 * An image path inside the book, or null when it is remote.
 *
 * Returns the archive path the resource lives at, which is what the reader resolves against the book. `data:`
 * images are kept as they are: they are already in the document we are reading, so nothing is fetched.
 */
export function resolveResource(src: string, basePath: string): string | null {
  const trimmed = src.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("data:")) return trimmed.startsWith("data:image/") ? trimmed : null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return null;
  return resolveRelative(trimmed, basePath);
}

/**
 * A link, as reader navigation: `#fragment` stays local, a path within the book becomes an archive path, and
 * anything outside the book loses its href rather than becoming a live link to the web.
 */
export function rewriteLink(href: string, basePath: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("#")) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return null;
  const resolved = resolveRelative(trimmed, basePath);
  return resolved === null ? null : `#${resolved}`;
}

/** Resolve a relative path against the document it appears in, dropping any fragment. */
function resolveRelative(path: string, basePath: string): string | null {
  const withoutFragment = path.split("#")[0] ?? "";
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // A book that percent-encodes badly still names a file; reading it as written beats refusing the book.
  }
  const base = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  const parts = `${base.length === 0 ? "" : `${base}/`}${decoded}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      stack.pop();
      continue;
    }
    if (part === "." || part.length === 0) continue;
    stack.push(part);
  }
  return stack.length === 0 ? null : stack.join("/");
}
