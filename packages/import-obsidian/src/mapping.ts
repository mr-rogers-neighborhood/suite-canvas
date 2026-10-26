/**
 * Owns the mapping from an Obsidian vault to a Suite workspace, as data.
 *
 * The table below is the contract: every source concept an importer can meet is
 * a row saying what it becomes and what does not travel. A test walks the table
 * against the fixture vault, so a gap is either a documented row or a failure.
 */

import type { SectionColor } from "@suite/graph";

/** One row of the mapping: a source concept, its target, and what is lost. */
export interface MappingRow {
  /** What the vault holds, named the way Obsidian names it. */
  source: string;
  /** What the workspace gets instead. */
  target: string;
  /** What travels, and what does not when it cannot. */
  detail: string;
}

export const VAULT_MAPPING: readonly MappingRow[] = [
  {
    source: "Vault root",
    target: "Home board",
    detail:
      "The workspace's first board holds every note outside a folder. Its name is the vault folder's name when the caller passes one.",
  },
  {
    source: "Folder",
    target: "Board",
    detail:
      "One board per folder that holds at least one note, named by the folder's whole path (`Projects / Notes`), so a nested hierarchy stays visible. A canvas file is a board of its own, so a folder of canvases needs no board. Boards have no parent, so the path is the hierarchy.",
  },
  {
    source: "Markdown note (`.md`)",
    target: "Card",
    detail:
      "One card per note, placed on its folder's board in a grid, because a note has no geometry of its own.",
  },
  {
    source: "First `#` heading",
    target: "Card title",
    detail:
      "Used when the heading opens the note; that block leaves the body. A note without one is titled by its file name.",
  },
  {
    source: "Note body",
    target: "Card body",
    detail:
      "Headings, paragraphs, block quotes, bullet and ordered lists (nested by indentation), fenced code with its language, and horizontal rules. Tables, HTML, footnotes and diagrams stay as the text they were written as.",
  },
  {
    source: "Frontmatter key matching a field name",
    target: "Card property",
    detail:
      "Matched case-insensitively against the workspace's field definitions and coerced by the field's kind: a select by option label, multi-select by label list, checkbox by truthiness, number by value. `fieldByKey` overrides the match with a field id.",
  },
  {
    source: "Frontmatter key with no field",
    target: "Body paragraph, plus a report row",
    detail:
      "Written as `key: value` at the end of the body under a `Properties` heading, and listed in `properties.keptAsText`. Every kept key appears in the report.",
  },
  {
    source: "Frontmatter that is not valid YAML",
    target: "Body text, plus a report row",
    detail: "The block is kept where it was, the note still imports, and the reason is reported.",
  },
  {
    source: "`tags:` / `tag:` in frontmatter",
    target: "Card tags",
    detail:
      "Every spelling Obsidian accepts: a comma string, a YAML list, or both keys. Names are normalised by `ensureTag`, which trims and matches case-insensitively.",
  },
  {
    source: "Inline `#tag`",
    target: "Card tag",
    detail:
      "The tag token leaves the body text and becomes a tag on the card. A `#` inside code is text, and a purely numeric tag is text, because Obsidian does not treat it as a tag either.",
  },
  {
    source: "`[[Note]]`",
    target: "Mention in the body, indexed by the reference index",
    detail:
      "Resolved against the vault by file name (then by path, then by the note's own folder). A resolved link becomes a mention node, so backlinks come from the existing index rather than a second edge record. An unresolved target stays as the text `[[Note]]` and is counted in the report.",
  },
  {
    source: "`[[Note|alias]]`, `[[Note#heading]]`",
    target: "Mention plus text",
    detail:
      "The alias or the heading is kept as text after the mention, so the sentence still reads.",
  },
  {
    source: "External link",
    target: "Link mark",
    detail:
      "A Markdown link whose address is `http`, `https` or `mailto` becomes a link mark on its label. Any other scheme keeps the label as text, drops the address, and is reported.",
  },
  {
    source: "`![[image.png]]`",
    target: "Text, plus a report row",
    detail:
      "Attachment bytes are not imported: the mention becomes the file's name as text and the path is listed under `attachments`.",
  },
  {
    source: "`.canvas` file",
    target: "Board",
    detail: "Named after the file, with one placement per node at its real geometry.",
  },
  {
    source: "Canvas `text` node",
    target: "Card",
    detail:
      "The node's first line becomes the title and the Markdown under it becomes the body, so nothing is duplicated on the card. Its `x`/`y`/`width`/`height` become the placement, and its colour becomes the card's surface role.",
  },
  {
    source: "Canvas `file` node",
    target: "The imported card for that file",
    detail:
      "A file node whose target is not in the vault becomes a card titled by the file name, with the path as its body text.",
  },
  {
    source: "Canvas `link` node",
    target: "Card",
    detail: "Titled by the address, which is also the card's body, so the URL is never lost.",
  },
  {
    source: "Canvas `group` node",
    target: "Section",
    detail:
      "Geometry and label carry over. A group whose label is empty gets a section titled `Group`.",
  },
  {
    source: "Canvas edge",
    target: "Link between the two cards",
    detail:
      "The edge's `label` becomes the link's label. A side hint (`fromSide`/`toSide`) is not stored: the link uses the default connector layout, and the report says so.",
  },
  {
    source: "Canvas node colour",
    target: "Section colour or card surface role",
    detail:
      "Obsidian's six presets map to the palette the schema names. A hex colour has no slot: the styles name roles rather than values, so it is reported instead of approximated.",
  },
  {
    source: "`.obsidian/` and unknown extensions",
    target: "Skipped, with a reason",
    detail:
      "Settings and files the importer cannot read appear in `skipped`; nothing is ignored silently.",
  },
];

/**
 * Obsidian's six preset colours, as the schema's nearest named colour. A section
 * takes the `section` value and a card the `surface` role: both are names the
 * theme resolves, never a stored hex.
 */
export const CANVAS_COLOUR_MAP: Readonly<
  Record<string, { section: SectionColor; surface: "accent" | "danger" | "success" | "warning" }>
> = {
  "1": { section: "rose", surface: "danger" },
  "2": { section: "amber", surface: "warning" },
  "3": { section: "amber", surface: "warning" },
  "4": { section: "green", surface: "success" },
  "5": { section: "blue", surface: "accent" },
  "6": { section: "violet", surface: "accent" },
};

/** The mapping for one canvas colour, or null when it is a hex value. */
export function canvasColour(
  value: string | undefined,
): { section: SectionColor; surface: "accent" | "danger" | "success" | "warning" } | null {
  if (!value) return null;
  return CANVAS_COLOUR_MAP[value.trim()] ?? null;
}

/** The table as Markdown rows, so the how-to page and the code cannot drift. */
export function mappingTableMarkdown(): string {
  const rows = VAULT_MAPPING.map((row) => `| ${row.source} | ${row.target} | ${row.detail} |`);
  return ["| Source | Target | What travels |", "| --- | --- | --- |", ...rows].join("\n");
}
