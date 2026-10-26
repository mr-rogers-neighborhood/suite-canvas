import type { PortableNode, PropertyValue, WorkspaceDocument } from "@suite/graph";
import { gridPosition } from "./boards.js";
import { blocksToNodes, type ConvertedNote, type LinkResolver } from "./convert.js";
import { folderOf } from "./files.js";
import { type Frontmatter, frontmatterTags, splitFrontmatter } from "./frontmatter.js";
import { type ParsedNote, parseMarkdown } from "./markdown.js";
import { keptPropertyLines, type PropertyField, planProperties } from "./properties.js";
import type { ImportReport } from "./report.js";

/**
 * Owns what one Markdown note becomes: a card with a title, a body, tags and
 * whatever properties its frontmatter can fill.
 *
 * A note is written in two passes because a `[[wikilink]]` cannot become a
 * mention until every card in the vault exists. The first pass makes the card,
 * its title and its tags; the second writes the body once the whole index can be
 * asked for a target.
 */

export interface PendingNote {
  path: string;
  folder: string;
  cardId: string;
  frontmatter: Frontmatter;
  parsed: ParsedNote;
  /** What the title cost: the note's own H1, or its file name. */
  title: string;
}

export interface CreateNoteInput {
  workspace: WorkspaceDocument;
  path: string;
  text: string;
  boardId: string;
  /** Position among the notes on this board, for the grid. */
  slot: number;
  /** Card type for a note whose frontmatter names none. */
  defaultTypeId: string;
  /** Resolves a tag name to its record id, counting new records once. */
  tagId: (name: string) => string;
}

/** A card type by name, or the fallback. Case-insensitive, like every name match. */
export function typeIdByName(
  workspace: WorkspaceDocument,
  name: unknown,
  fallback: string,
): string {
  const needle = typeof name === "string" ? name.trim().toLocaleLowerCase() : "";
  if (needle.length === 0) return fallback;
  return (
    workspace.listTypes().find((type) => type.name.toLocaleLowerCase() === needle)?.id ?? fallback
  );
}

/** Every `#tag` a parsed body names, in document order. */
export function inlineTagsOf(parsed: ParsedNote): string[] {
  const names: string[] = [];
  for (const block of parsed.blocks) {
    if (block.kind === "code" || block.kind === "rule") continue;
    for (const token of block.inline) {
      if (token.kind === "tag" && !names.includes(token.name)) names.push(token.name);
    }
  }
  return names;
}

/** First pass: the card, its title, its type and its tags. */
export function createNoteCard(input: CreateNoteInput): PendingNote {
  const { workspace, path, text, boardId } = input;
  const frontmatter = splitFrontmatter(text);
  const parsed = parseMarkdown(frontmatter.body);
  const fallbackTitle = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/iu, "");
  const title = parsed.title ?? fallbackTitle;

  const card = workspace.createCard({
    boardId,
    position: gridPosition(input.slot),
    typeId: typeIdByName(workspace, frontmatter.data.type, input.defaultTypeId),
    fromTemplate: false,
  });
  workspace.setTitleText(card.id, title);

  const names = new Set([...frontmatterTags(frontmatter.data), ...inlineTagsOf(parsed)]);
  for (const name of names) workspace.addCardTag(card.id, input.tagId(name));

  return { path, folder: folderOf(path), cardId: card.id, frontmatter, parsed, title };
}

export interface FinishNoteInput {
  workspace: WorkspaceDocument;
  note: PendingNote;
  resolve: LinkResolver;
  fieldByKey?: Readonly<Record<string, string>> | undefined;
  /** A card id for a wikilink-shaped property value. */
  resolveCard: (target: string) => string | null;
  report: ImportReport;
}

/**
 * Second pass: the body, the properties the frontmatter fills, and the
 * paragraphs kept for keys no field claimed.
 */
export function finishNote(input: FinishNoteInput): ConvertedNote {
  const { workspace, note, report } = input;
  const converted = blocksToNodes(note.parsed.blocks, input.resolve);

  const plan = planProperties({
    data: note.frontmatter.data,
    keys: note.frontmatter.keys,
    // Only the fields this card's own types carry: a value written to a field the
    // card does not have is a value nothing can show.
    fields: fieldsForCard(workspace, note.cardId),
    fieldByKey: input.fieldByKey,
    resolveCard: input.resolveCard,
  });

  const nodes: PortableNode[] = [...converted.nodes];
  const kept = [...plan.kept];
  if (note.frontmatter.error) kept.unshift({ key: "frontmatter", text: note.frontmatter.error });
  if (kept.length > 0) {
    nodes.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Properties" }],
    });
    for (const line of keptPropertyLines(kept)) {
      nodes.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    }
  }
  if (nodes.length > 0) workspace.setBodyNodes(note.cardId, nodes);

  for (const property of plan.properties) {
    writeProperty(workspace, note.cardId, property.fieldId, property.value, report);
  }

  report.links.resolved += converted.resolved;
  for (const target of converted.unresolved) {
    if (!report.links.unresolved.includes(target)) report.links.unresolved.push(target);
  }
  for (const target of converted.ambiguous) {
    if (!report.links.ambiguous.includes(target)) report.links.ambiguous.push(target);
  }
  report.properties.mapped += plan.properties.length;
  for (const entry of plan.kept) {
    report.properties.keptAsText.push({ path: note.path, key: entry.key });
  }
  for (const problem of plan.problems) report.notes.push(`${note.path}: ${problem}`);
  for (const embed of converted.embeds) {
    if (report.attachments.some((entry) => entry.path === embed)) continue;
    report.attachments.push({
      path: embed,
      reason: "Attachment bytes are not imported; the reference was kept as text.",
    });
  }
  for (const href of converted.refusedLinks) {
    report.notes.push(
      `${note.path}: ${href} is not an http, https or mailto address, so its label was kept as text.`,
    );
  }
  return converted;
}

/** The field definitions the card's own types carry. */
export function fieldsForCard(workspace: WorkspaceDocument, cardId: string): PropertyField[] {
  const card = workspace.getCard(cardId);
  if (!card) return [];
  return workspace.viewCardFields(card).map((view) => ({
    id: view.field.id,
    name: view.field.name,
    kind: view.field.kind,
    options: view.field.options,
  }));
}

/** One property write, reported rather than thrown when the graph refuses it. */
function writeProperty(
  workspace: WorkspaceDocument,
  cardId: string,
  fieldId: string,
  value: PropertyValue,
  report: ImportReport,
): void {
  try {
    workspace.setProperty(cardId, fieldId, value);
  } catch (error) {
    report.notes.push(
      `A property value was refused by the document (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}
