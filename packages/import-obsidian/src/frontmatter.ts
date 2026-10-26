import { parse as parseYaml } from "yaml";

/**
 * Owns the frontmatter block: splitting it off a note, parsing it as YAML, and
 * keeping what Obsidian's own property editor writes (text, number, checkbox,
 * date, list).
 *
 * A block that does not parse is kept, not dropped: the note still imports, with
 * the block left at the top of its body and the failure named in the report.
 */

export interface Frontmatter {
  /** Parsed keys, in the order the block listed them. */
  data: Record<string, unknown>;
  /** Raw key order, since a YAML map does not promise insertion order to a reader. */
  keys: string[];
  /** The note without its frontmatter block. */
  body: string;
  /** The block as written, without the fences; null when there was none. */
  raw: string | null;
  /** Why the block could not be used as properties, when it could not. */
  error: string | null;
}

const FENCE = "---";

function isFence(line: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed === FENCE || trimmed === "...";
}

/**
 * Splits a note into frontmatter and body. A block counts only at the very top of
 * the file, which is where Obsidian writes it and where a `---` elsewhere is
 * a horizontal rule instead.
 */
export function splitFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^\uFEFF/u, "");
  const lines = text.split("\n");
  const opening = lines[0]?.trimEnd();
  if (opening !== FENCE) {
    return { data: {}, keys: [], body: text, raw: null, error: null };
  }
  const closing = lines.findIndex((line, index) => index > 0 && isFence(line));
  if (closing < 0) {
    // An unclosed block is not frontmatter; the note keeps its text unchanged.
    return {
      data: {},
      keys: [],
      body: text,
      raw: null,
      error: "The frontmatter block is never closed, so it was kept as body text.",
    };
  }
  const raw = lines.slice(1, closing).join("\n");
  const body = lines.slice(closing + 1).join("\n");
  try {
    const parsed: unknown = parseYaml(raw);
    if (parsed === null || parsed === undefined) {
      return { data: {}, keys: [], body, raw, error: null };
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        data: {},
        keys: [],
        body,
        raw,
        error: "The frontmatter is not a set of keys, so it was kept as body text.",
      };
    }
    const data = parsed as Record<string, unknown>;
    return { data, keys: Object.keys(data), body, raw, error: null };
  } catch (error) {
    return {
      data: {},
      keys: [],
      body,
      raw,
      error: `The frontmatter is not valid YAML (${error instanceof Error ? error.message : String(error)}), so it was kept as body text.`,
    };
  }
}

/** The key whose case-insensitive name matches, or undefined. */
export function findKey(data: Record<string, unknown>, name: string): string | undefined {
  const needle = name.toLocaleLowerCase();
  return Object.keys(data).find((key) => key.trim().toLocaleLowerCase() === needle);
}

/**
 * Tags a note declares. Obsidian accepts `tags: a, b`, `tags: [a, b]`, a YAML
 * list, and the singular `tag`. Every spelling is normalised to the same list.
 */
export function frontmatterTags(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const name of ["tags", "tag"]) {
    const key = findKey(data, name);
    if (key === undefined) continue;
    out.push(...tagValues(data[key]));
  }
  return out;
}

function tagValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[,\n]/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (Array.isArray(value)) return value.flatMap(tagValues);
  if (typeof value === "number") return [String(value)];
  return [];
}

/** Display text for a value the importer keeps rather than maps. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(describeValue).join(", ");
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
