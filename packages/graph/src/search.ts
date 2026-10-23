import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { loroTreeToJson, type PortableNode } from "./portable.js";

/**
 * The index is a plain `cardId → text` map so it can be built once, cached and
 * patched. Each value holds the card's title, a `\n` separator, then its body:
 * the separator is what lets a hit say whether it matched the title or the
 * body without a second lookup. Both halves are already normalized, so they
 * never contain a newline of their own.
 */
const FIELD_SEPARATOR = "\n";

const COMBINING_MARKS = /\p{M}+/gu;
const WHITESPACE = /\s+/gu;

const DEFAULT_LIMIT = 200;
const DEFAULT_SNIPPET_RADIUS = 40;
const ELLIPSIS = "\u2026";

/** Lowercase, diacritic-free, whitespace-collapsed text used on both sides. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(WHITESPACE, " ")
    .trim();
}

/** The normalized terms of a query. An empty or blank query has no terms. */
export function searchTerms(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (normalized.length === 0) return [];
  return [...new Set(normalized.split(" ").filter((term) => term.length > 0))];
}

/**
 * Title inline text through the shared ProseMirror walker, so a mention or a
 * mark does not change what the title reads as.
 */
function titleText(nodes: readonly PortableNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.text !== undefined) {
      text += node.text;
      continue;
    }
    if (node.content) text += titleText(node.content);
  }
  return text;
}

/**
 * A link image is text: an address and a label, with no text child for the
 * generic walker to find. So the index adds both explicitly, and a card can be
 * found by the URL the picture points at or by the alt text it carries.
 */
function imageText(nodes: readonly PortableNode[] | undefined): string {
  let text = "";
  for (const node of nodes ?? []) {
    if (node.type === "image") {
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      text += ` ${alt} ${src} `;
    }
    if (node.content) text += imageText(node.content);
  }
  return text;
}

/**
 * Searchable text for one card: normalized title, separator, normalized body.
 * The title comes from the title container only, so an untitled card is not
 * findable through the "Untitled" placeholder the UI shows for it.
 */
export function cardSearchText(workspace: WorkspaceDocument, cardId: string): string {
  const title = normalizeSearchText(titleText(loroTreeToJson(workspace.peekTitle(cardId))));
  const body = normalizeSearchText(
    `${workspace.cardText(cardId)} ${imageText(loroTreeToJson(workspace.peekContent(cardId)))}`,
  );
  if (title.length === 0) return body;
  if (body.length === 0) return title;
  return `${title}${FIELD_SEPARATOR}${body}`;
}

/**
 * One card id → searchable text, for every card in the workspace including the
 * ones in the trash. Built once per index build; the client patches single
 * entries afterwards instead of re-extracting every body.
 */
export function buildSearchText(workspace: WorkspaceDocument): Map<string, string> {
  const index = new Map<string, string>();
  for (const card of workspace.listCards()) {
    index.set(card.id, cardSearchText(workspace, card.id));
  }
  return index;
}

export interface SearchRange {
  start: number;
  end: number;
}

export type SearchField = "title" | "body";

export interface SearchHit {
  id: string;
  /** Which half of the indexed text matched; title hits rank first. */
  field: SearchField;
  /** Offset of the first matched term inside that field's text. */
  position: number;
  /** Normalized title for a title hit, or a window of the body around the match. */
  snippet: string;
  /** Matched ranges inside `snippet`, for highlighting. */
  highlights: SearchRange[];
  /** Normalized terms that matched; reuse them to highlight the live title. */
  terms: string[];
}

export interface SearchOptions {
  /** Maximum number of hits; the default is generous because the UI re-filters. */
  limit?: number;
  /** Characters of context on each side of a body match. */
  snippetRadius?: number;
}

interface Candidate extends SearchHit {
  /** Sort key for ties: the normalized title, so equal matches read A→Z. */
  alphabet: string;
}

function firstMatch(text: string, terms: readonly string[]): number | null {
  let best: number | null = null;
  for (const term of terms) {
    const at = text.indexOf(term);
    if (at === -1) continue;
    if (best === null || at < best) best = at;
  }
  return best;
}

function longestTerm(terms: readonly string[]): number {
  let longest = 0;
  for (const term of terms) longest = Math.max(longest, term.length);
  return longest;
}

function fieldRank(field: SearchField): number {
  return field === "title" ? 0 : 1;
}

/**
 * Ranked hits for `query` over an index from `buildSearchText`. Every term must
 * match, in any field; title matches come first, then earlier matches, then
 * alphabetically. A blank query has no hits.
 */
export function searchCards(
  index: ReadonlyMap<string, string>,
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const radius = Math.max(0, options.snippetRadius ?? DEFAULT_SNIPPET_RADIUS);
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const candidates: Candidate[] = [];

  for (const [id, text] of index) {
    const split = text.indexOf(FIELD_SEPARATOR);
    const title = split === -1 ? "" : text.slice(0, split);
    const body = split === -1 ? text : text.slice(split + 1);
    const inTitle = title.length > 0 && terms.every((term) => title.includes(term));
    if (!inTitle && !terms.every((term) => text.includes(term))) continue;

    const haystack = inTitle ? title : body;
    const position = firstMatch(haystack, terms);
    if (position === null) continue;

    if (inTitle) {
      candidates.push({
        id,
        field: "title",
        position,
        snippet: title,
        highlights: highlightRanges(title, terms),
        terms,
        alphabet: title,
      });
      continue;
    }

    const from = Math.max(0, position - radius);
    const to = Math.min(body.length, position + longestTerm(terms) + radius);
    const prefix = from > 0 ? ELLIPSIS : "";
    const suffix = to < body.length ? ELLIPSIS : "";
    const window = body.slice(from, to);
    candidates.push({
      id,
      field: "body",
      position,
      snippet: `${prefix}${window}${suffix}`,
      highlights: highlightRanges(window, terms).map((range) => ({
        start: range.start + prefix.length,
        end: range.end + prefix.length,
      })),
      terms,
      alphabet: title,
    });
  }

  candidates.sort(
    (a, b) =>
      fieldRank(a.field) - fieldRank(b.field) ||
      a.position - b.position ||
      a.alphabet.localeCompare(b.alphabet) ||
      a.id.localeCompare(b.id),
  );

  return candidates.slice(0, limit).map(({ alphabet: _alphabet, ...hit }) => hit);
}

interface FoldedText {
  text: string;
  /** Original offsets for every normalized code unit, so ranges map back. */
  starts: number[];
  ends: number[];
}

/** Normalization that remembers where each output character came from. */
function foldWithOffsets(input: string): FoldedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;

  for (const char of input) {
    const start = offset;
    offset += char.length;

    if (/\s/u.test(char)) {
      if (text.length === 0 || text.endsWith(" ")) continue;
      text += " ";
      starts.push(start);
      ends.push(offset);
      continue;
    }

    const folded = char.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
    for (let index = 0; index < folded.length; index += 1) {
      text += folded[index];
      starts.push(start);
      ends.push(offset);
    }
  }

  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { text, starts, ends };
}

function mergeRanges(ranges: SearchRange[]): SearchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SearchRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * Ranges of `terms` inside the *original* `text`, in original coordinates.
 * Diacritics and case are ignored on the way in, so a result title can be
 * highlighted with the same terms the index matched.
 */
export function highlightRanges(text: string, terms: readonly string[]): SearchRange[] {
  if (text.length === 0 || terms.length === 0) return [];
  const folded = foldWithOffsets(text);
  const ranges: SearchRange[] = [];

  for (const raw of terms) {
    const term = normalizeSearchText(raw);
    if (term.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = folded.text.indexOf(term, from);
      if (at === -1) break;
      const start = folded.starts[at];
      const end = folded.ends[at + term.length - 1];
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
      from = at + term.length;
    }
  }

  return mergeRanges(ranges);
}
