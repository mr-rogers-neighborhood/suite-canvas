import { type LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { flatMap, fromEntries } from "remeda";
import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { mentionTargets, outgoingReferences, type ReferenceIndex } from "../references.js";
import type { Card } from "../schema.js";

import { copyDrawing, copyEntry } from "./containers.js";
import { PRIVATE_REFERENCE_TITLE, type ProjectionReference } from "./workspace.js";

/**
 * Owns what a projection does about references: which cards are copied, what they point
 * at, and the placeholder title a redacted reference shows.
 */

/**
 * The mention index the projection needs, parsed from live text instead of the
 * workspace's derived index: a share can be built before the coalescing
 * microtask that refreshes the stored index has run.
 */
function mentionIndex(source: WorkspaceDocument, cards: readonly Card[]): ReferenceIndex {
  const index: Record<string, string[]> = {};
  for (const card of cards) {
    const targets = mentionTargets([source.peekTitle(card.id), source.peekContent(card.id)]);
    if (targets.length > 0) index[card.id] = targets;
  }
  return index;
}

/** Copies the cards, their content and the schema they depend on. */
export function copyCards(
  source: WorkspaceDocument,
  target: LoroDoc,
  copied: ReadonlySet<string>,
): void {
  const sourceCards = source.doc.getMap(WorkspaceDocument.CARDS_KEY);
  const sourceTypes = source.doc.getMap(WorkspaceDocument.TYPES_KEY);
  const sourceTags = source.doc.getMap(WorkspaceDocument.TAGS_KEY);
  const sourceContent = source.doc.getMap(WorkspaceDocument.CONTENT_KEY);
  const sourceTitles = source.doc.getMap(WorkspaceDocument.TITLES_KEY);
  const sourceDrawings = WorkspaceDocument.drawingRoot(source.doc);
  const targetCards = target.getMap(WorkspaceDocument.CARDS_KEY);
  const targetTypes = target.getMap(WorkspaceDocument.TYPES_KEY);
  const targetTags = target.getMap(WorkspaceDocument.TAGS_KEY);
  const targetContent = target.getMap(WorkspaceDocument.CONTENT_KEY);
  const targetTitles = target.getMap(WorkspaceDocument.TITLES_KEY);
  const targetDrawings = WorkspaceDocument.drawingRoot(target);

  const typeIds = new Set<string>();
  const tagIds = new Set<string>();

  for (const cardId of [...copied].sort()) {
    const card = source.getCard(cardId);
    if (!card) continue;
    copyEntry(sourceCards, targetCards, cardId);
    for (const typeId of card.typeIds) typeIds.add(typeId);
    for (const tagId of card.tags) tagIds.add(tagId);
    copyEntry(sourceContent, targetContent, cardId);
    copyEntry(sourceTitles, targetTitles, cardId);
    // A shared whiteboard carries its scene; a card left out of the share does
    // not, which is the same redaction body text gets.
    copyDrawing(sourceDrawings, targetDrawings, cardId);
  }

  // Only the schema the shared cards actually use travels with them.
  for (const typeId of [...typeIds].sort()) copyEntry(sourceTypes, targetTypes, typeId);
  for (const tagId of [...tagIds].sort()) copyEntry(sourceTags, targetTags, tagId);
}

export function collectReferences(
  source: WorkspaceDocument,
  copied: ReadonlySet<string>,
  redactPrivateTitles: boolean,
): ProjectionReference[] {
  const trashed = new Set(source.listTrashedCards().map((card) => card.id));
  const cards = source.listCards().filter((card) => !card.deletedAt);
  const types = source.listTypes();
  const edges = source
    .listEdges()
    .filter((edge) => !trashed.has(edge.source) && !trashed.has(edge.target));
  const mentions = mentionIndex(source, cards);

  const seen = new Set<string>();
  const rows: ProjectionReference[] = [];

  const add = (
    cardId: string,
    direction: "in" | "out",
    kind: ProjectionReference["kind"],
  ): void => {
    if (trashed.has(cardId)) return;
    const dedupe = `${cardId}\u0000${direction}\u0000${kind}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    // A board share may say a link exists but not name the off-board card it
    // points at. A card share shows those titles as inert context.
    const isPrivate = !copied.has(cardId);
    rows.push({
      cardId,
      title:
        isPrivate && redactPrivateTitles ? PRIVATE_REFERENCE_TITLE : source.displayTitle(cardId),
      direction,
      kind,
      private: isPrivate,
    });
  };

  // One pass builds the adjacency this loop reads. Asking the per-card helpers
  // for every copied card re-scans the whole workspace each time, which made a
  // 5 000-card board cost ~19 s per rebuild instead of well under a second:
  // `incomingReferences`, `propertySources` and `arrowSources` were O(cards),
  // O(cards) and O(edges) per card.
  const mentionIn = new Map<string, string[]>();
  for (const [originId, targets] of Object.entries(mentions)) {
    for (const targetId of targets) {
      const list = mentionIn.get(targetId);
      if (list) list.push(originId);
      else mentionIn.set(targetId, [originId]);
    }
  }

  const fieldKinds = fromEntries(
    flatMap(types, (type) => type.fields.map((field) => [field.id, field.kind] as const)),
  );
  const propertyOut = new Map<string, string[]>();
  const propertyIn = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const card of cards) {
    for (const [fieldId, value] of Object.entries(card.properties)) {
      if (typeof value !== "string" || value.length === 0) continue;
      // An unknown field is kept, so a missing type definition never hides a link.
      const kind = fieldKinds[fieldId];
      if (kind !== undefined && kind !== "card") continue;
      // `outgoingPropertyLinks` excludes a self-link; `propertySources` does not.
      if (value !== card.id) push(propertyOut, card.id, value);
      push(propertyIn, value, card.id);
    }
  }

  const arrowOut = new Map<string, string[]>();
  const arrowIn = new Map<string, string[]>();
  for (const edge of edges) {
    push(arrowOut, edge.source, edge.target);
    push(arrowIn, edge.target, edge.source);
  }

  for (const cardId of [...copied].sort()) {
    for (const targetId of outgoingReferences(cardId, mentions)) add(targetId, "out", "mention");
    for (const originId of mentionIn.get(cardId) ?? []) add(originId, "in", "mention");
    for (const targetId of propertyOut.get(cardId) ?? []) add(targetId, "out", "property");
    for (const originId of propertyIn.get(cardId) ?? []) add(originId, "in", "property");
    for (const otherId of arrowOut.get(cardId) ?? []) add(otherId, "out", "arrow");
    for (const otherId of arrowIn.get(cardId) ?? []) add(otherId, "in", "arrow");
  }

  return rows.sort(
    (a, b) =>
      a.cardId.localeCompare(b.cardId) ||
      a.direction.localeCompare(b.direction) ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Gives every out-of-share reference a title container, so the viewer reads the
 * row's label from the projection instead of falling back to "Untitled". Only
 * the title is written: the stub has no card record, content, placement or
 * type, so it stays non-navigable.
 */
export function writeReferenceTitleStubs(
  workspace: WorkspaceDocument,
  references: readonly ProjectionReference[],
  copied: ReadonlySet<string>,
): void {
  const titles = workspace.doc.getMap(WorkspaceDocument.TITLES_KEY);
  const written = new Set<string>();

  for (const reference of references) {
    if (copied.has(reference.cardId) || written.has(reference.cardId)) continue;
    written.add(reference.cardId);

    const root = titles.ensureMergeableMap(reference.cardId);
    root.set("nodeName", "doc");
    root.ensureMergeableMap("attributes");
    const blocks = root.ensureMergeableList("children");
    const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    const text = inline.insertContainer(0, new LoroText());
    text.insert(0, reference.title);
  }
}
