/**
 * Owns reading a note's Markdown into the blocks and inline runs the graph writes.
 *
 * This is a reading, not a Markdown engine: headings, paragraphs, quotes, lists,
 * fenced code, rules, emphasis, links, `[[wikilinks]]`, `![[embeds]]` and
 * `#tags`. Anything else (tables, HTML, footnotes, mermaid) stays as its own
 * text, which is the honest outcome for a canvas that holds prose and links.
 *
 * The output is a token list rather than rich-text nodes because a wikilink
 * cannot become a mention until every card exists.
 */

export type MarkName = "bold" | "italic" | "strike" | "code";

export type InlineToken =
  | { kind: "text"; text: string; marks: MarkName[] }
  | { kind: "wikilink"; target: string; alias?: string; heading?: string }
  | { kind: "embed"; target: string }
  | { kind: "tag"; name: string }
  | { kind: "link"; text: string; href: string };

export type BlockToken =
  | { kind: "heading"; level: number; inline: InlineToken[] }
  | { kind: "paragraph"; inline: InlineToken[] }
  | { kind: "quote"; inline: InlineToken[] }
  | { kind: "list"; ordered: boolean; depth: number; inline: InlineToken[] }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "rule" };

const WIKILINK = /!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/u;
// One level of parentheses inside the address, which is where a Wikipedia link lives.
const EXTERNAL_LINK = /^\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/u;
const TAG = /^#([\p{L}\p{N}_/-]+)/u;
const HEADING = /^(#{1,6})\s+(.*)$/u;
const BULLET = /^(\s*)[-*+]\s+(.*)$/u;
const ORDERED = /^(\s*)\d{1,9}[.)]\s+(.*)$/u;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/u;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/u;

/** A tag must hold at least one non-digit: `#1` is a number, not a tag. */
function isTagName(name: string): boolean {
  return /\p{L}/u.test(name);
}

function textToken(text: string, marks: MarkName[] = []): InlineToken {
  return { kind: "text", text, marks: [...marks] };
}

/** One line of Markdown as inline runs. Consecutive plain characters merge. */
export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let plain = "";
  const flush = () => {
    if (plain.length > 0) tokens.push(textToken(plain));
    plain = "";
  };

  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);

    if (rest.startsWith("\\") && index + 1 < line.length) {
      plain += line[index + 1];
      index += 2;
      continue;
    }

    if (rest.startsWith("!") || rest.startsWith("[")) {
      const wiki = WIKILINK.exec(rest);
      if (wiki && rest.startsWith("!")) {
        flush();
        tokens.push({ kind: "embed", target: (wiki[1] ?? "").trim() });
        index += wiki[0].length;
        continue;
      }
      if (wiki) {
        flush();
        tokens.push({
          kind: "wikilink",
          target: (wiki[1] ?? "").trim(),
          ...(wiki[2] ? { heading: wiki[2].trim() } : {}),
          ...(wiki[3] ? { alias: wiki[3].trim() } : {}),
        });
        index += wiki[0].length;
        continue;
      }
      const external = EXTERNAL_LINK.exec(rest);
      if (external) {
        flush();
        tokens.push({
          kind: "link",
          text: external[1] ?? "",
          href: external[2] ?? "",
        });
        index += external[0].length;
        continue;
      }
    }

    if (rest.startsWith("#") && (index === 0 || /\s|\(/u.test(line[index - 1] ?? ""))) {
      const tag = TAG.exec(rest);
      if (tag && isTagName(tag[1] ?? "")) {
        flush();
        tokens.push({ kind: "tag", name: tag[1] ?? "" });
        index += tag[0].length;
        continue;
      }
    }

    const delimited = emphasisAt(rest);
    if (delimited) {
      flush();
      tokens.push(textToken(delimited.text, [delimited.mark]));
      index += delimited.length;
      continue;
    }

    if (rest.startsWith("`")) {
      const close = rest.indexOf("`", 1);
      if (close > 0) {
        flush();
        tokens.push(textToken(rest.slice(1, close), ["code"]));
        index += close + 1;
        continue;
      }
    }

    plain += line[index];
    index += 1;
  }
  flush();
  return tokens;
}

/**
 * One level of emphasis. `**x**`, `__x__`, `*x*`, `_x_` and `~~x~~`; nesting is
 * not read, so `**a *b***` imports as bold `a *b*`, which loses a style rather
 * than text.
 */
function emphasisAt(text: string): { text: string; mark: MarkName; length: number } | null {
  const pairs: Array<[string, MarkName]> = [
    ["**", "bold"],
    ["__", "bold"],
    ["~~", "strike"],
    ["*", "italic"],
    ["_", "italic"],
  ];
  for (const [delimiter, mark] of pairs) {
    if (!text.startsWith(delimiter)) continue;
    const close = text.indexOf(delimiter, delimiter.length);
    if (close <= delimiter.length) continue;
    return {
      text: text.slice(delimiter.length, close),
      mark,
      length: close + delimiter.length,
    };
  }
  return null;
}

export interface ParsedNote {
  /** The first level-1 heading when it opens the note; the title's source. */
  title: string | null;
  blocks: BlockToken[];
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Splits a note body into blocks. A level-1 heading that opens the note is taken
 * as the title and removed, which is Obsidian's own reading of a note.
 */
export function parseMarkdown(source: string): ParsedNote {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: BlockToken[] = [];
  let paragraph: InlineToken[] = [];
  let title: string | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inline: paragraph });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1] ?? "```";
      const language = fence[2] ? fence[2] : null;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith(marker)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ kind: "code", language, text: body.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? "#").length;
      const inline = parseInline(heading[2] ?? "");
      const plain = inline
        .map((token) => (token.kind === "text" ? token.text : ""))
        .join("")
        .trim();
      if (level === 1 && title === null && blocks.length === 0) {
        title = plain.length > 0 ? plain : null;
      } else {
        blocks.push({ kind: "heading", level, inline });
      }
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    if (/^\s*>/u.test(line)) {
      flushParagraph();
      const quoted = line.replace(/^\s*>\s?/u, "");
      blocks.push({ kind: "quote", inline: parseInline(quoted) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const [, spaces = "", content = ""] = (bullet ?? ordered) as RegExpExecArray;
      blocks.push({
        kind: "list",
        ordered: Boolean(ordered && !bullet),
        depth: Math.min(6, Math.floor(leadingSpaces(spaces) / 2)),
        inline: parseInline(content),
      });
      continue;
    }

    if (paragraph.length > 0) paragraph.push(textToken(" "));
    paragraph.push(...parseInline(line.trim()));
  }
  flushParagraph();
  return { title, blocks };
}

/** Every tag a body declares, in document order, deduplicated. */
export function collectTags(blocks: readonly BlockToken[]): string[] {
  const out: string[] = [];
  walkInline(blocks, (token) => {
    if (token.kind === "tag" && !out.includes(token.name)) out.push(token.name);
  });
  return out;
}

/** Every wikilink target a body names, resolved or not, deduplicated. */
export function collectLinkTargets(blocks: readonly BlockToken[]): string[] {
  const out: string[] = [];
  walkInline(blocks, (token) => {
    if (token.kind === "wikilink" && !out.includes(token.target)) out.push(token.target);
  });
  return out;
}

/** Every embedded file path a body names, deduplicated. */
export function collectEmbeds(blocks: readonly BlockToken[]): string[] {
  const out: string[] = [];
  walkInline(blocks, (token) => {
    if (token.kind === "embed" && !out.includes(token.target)) out.push(token.target);
  });
  return out;
}

function walkInline(blocks: readonly BlockToken[], visit: (token: InlineToken) => void): void {
  for (const block of blocks) {
    if (block.kind === "code" || block.kind === "rule") continue;
    for (const token of block.inline) visit(token);
  }
}

/** Plain text of a block, for a title or a report line. */
export function plainText(inline: readonly InlineToken[]): string {
  return inline
    .map((token) => (token.kind === "text" ? token.text : token.kind === "link" ? token.text : ""))
    .join("")
    .trim();
}
