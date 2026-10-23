/**
 * Owns writing: `applyPublish`, `applyChange` and the container overwrite
 * helpers that replay a plan's captured values into the source document in one
 * commit with `PUBLISH_ORIGIN`.
 *
 * Apply never validates: planning already rejected every malformed value, and
 * a second opinion here would let the two disagree. Its only guards are replay
 * guards ("is this already true?"), so applying a plan twice is a no-op, and it
 * must never widen a change beyond the value the plan captured.
 */

import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { placementKey, WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { type BlockTarget, type BodyBlock, readBodyBlocks } from "./blocks.js";
import {
  allowedFieldIds,
  type PublishChange,
  type PublishPlan,
  type PublishValue,
} from "./plan.js";
import {
  isList,
  isMap,
  isTextSnapshot,
  type RichTextSnapshot,
  same,
  snapshotText,
  snapshotValue,
} from "./snapshot.js";

/**
 * Origin of the single commit a publish writes. It is deliberately its own
 * origin: a publish is one discrete change, with its own undo step, and peers
 * can tell it apart from a live edit.
 */
export const PUBLISH_ORIGIN = "share:publish";

function overwriteText(target: LoroText, delta: ReturnType<LoroText["toDelta"]>): void {
  if (target.length > 0) target.delete(0, target.length);
  if (delta.length > 0) target.applyDelta(delta);
}

function overwriteList(target: LoroList, snapshot: readonly RichTextSnapshot[]): void {
  target.clear();
  snapshot.forEach((value, index) => {
    if (isTextSnapshot(value)) {
      overwriteText(target.insertContainer(index, new LoroText()), value.$text);
      return;
    }
    if (Array.isArray(value)) {
      const list = target.insertContainer(index, new LoroList());
      overwriteList(list, value);
      return;
    }
    if (value !== null && typeof value === "object") {
      const map = target.insertContainer(index, new LoroMap());
      overwriteMap(map, value);
      return;
    }
    if (value !== null) target.insert(index, value);
  });
}

/**
 * Replaces a container's contents with a snapshot. `clear()` frees the keys, but
 * `ensureMergeable*` may hand back the container it just detached, so every child
 * is cleared before it is filled; applying the same snapshot twice is a no-op.
 */
function overwriteMap(
  target: LoroMap,
  snapshot: { readonly [key: string]: RichTextSnapshot },
): void {
  target.clear();
  for (const [key, value] of Object.entries(snapshot)) {
    if (isTextSnapshot(value)) {
      overwriteText(target.ensureMergeableText(key), value.$text);
      continue;
    }
    if (Array.isArray(value)) {
      overwriteList(target.ensureMergeableList(key), value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      overwriteMap(target.ensureMergeableMap(key), value);
      continue;
    }
    target.set(key, value);
  }
}

/** Writes a rich text tree into an existing root container, changed or not. */
function writeRichText(target: LoroMap, snapshot: RichTextSnapshot): void {
  if (
    snapshot !== null &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    !isTextSnapshot(snapshot)
  ) {
    overwriteMap(target, snapshot);
    return;
  }
  target.clear();
}

/** The block list of a card body, without creating anything. */
function bodyChildren(source: WorkspaceDocument, cardId: string): LoroList | null {
  const content = source.peekContent(cardId);
  if (!content) return null;
  const children = content.get("children");
  return isList(children) ? children : null;
}

/**
 * Where a planned block is now. The structural key is the reliable answer while
 * only the draft changed the block; the baseline index is the fallback for a
 * block the workspace also rewrote, and it only counts when the node name still
 * matches, so a fallback can never rewrite a different kind of block.
 *
 * A removal never falls back: content that is already gone is exactly what the
 * removal asked for, and deleting whoever sits at that index now would be a
 * silent loss.
 */
function resolveBlockIndex(
  blocks: readonly BodyBlock[],
  target: BlockTarget,
  allowFallback: boolean,
): number {
  const exact = blocks.findIndex((block) => block.key === target.key);
  if (exact >= 0 || !allowFallback) return exact;
  const candidate = blocks[target.index];
  return candidate && candidate.nodeName === target.nodeName ? target.index : -1;
}

function applyBodyBlock(
  source: WorkspaceDocument,
  cardId: string,
  target: BlockTarget,
  value: Extract<PublishValue, { kind: "body-block" }>,
): boolean {
  if (!source.getCard(cardId)) return false;
  const children = bodyChildren(source, cardId);
  if (!children) return false;
  const blocks = readBodyBlocks(source, cardId);

  if (value.op === "insert") {
    // Already there: the same block can arrive from a second apply, or from a
    // peer that added it independently.
    if (blocks.some((block) => block.key === target.key)) return false;
    const anchor = target.after ? blocks.findIndex((block) => block.key === target.after) : -1;
    const position = anchor >= 0 ? anchor + 1 : Math.min(Math.max(target.index, 0), blocks.length);
    const inserted = children.insertContainer(position, new LoroMap());
    writeRichText(inserted, value.block);
    return true;
  }

  const index = resolveBlockIndex(blocks, target, value.op !== "remove");
  if (index < 0) return false;
  if (value.op === "remove") {
    children.delete(index, 1);
    return true;
  }
  const node = children.get(index);
  if (!isMap(node)) return false;
  if (same(snapshotValue(node), value.block)) return false;
  writeRichText(node, value.block);
  return true;
}

function placementFields(
  source: WorkspaceDocument,
  boardId: string,
  cardId: string,
): LoroMap | null {
  const value = source.doc
    .getMap(WorkspaceDocument.PLACEMENTS_KEY)
    .get(placementKey(boardId, cardId));
  return isMap(value) ? value : null;
}

function applyChange(
  source: WorkspaceDocument,
  change: PublishChange,
  value: PublishValue,
): boolean {
  switch (change.kind) {
    case "title":
    case "body": {
      if (value.kind === "body-block") {
        if (!change.cardId || !change.block) return false;
        return applyBodyBlock(source, change.cardId, change.block, value);
      }
      if (value.kind !== "text" || !change.cardId) return false;
      const cardId = change.cardId;
      if (!source.getCard(cardId)) return false;
      const existing =
        change.kind === "title" ? source.peekTitle(cardId) : source.peekContent(cardId);
      if (!existing) {
        if (value.tree === null) return false;
        const created =
          change.kind === "title" ? source.getTitle(cardId) : source.getContent(cardId);
        writeRichText(created, value.tree);
        return true;
      }
      if (same(snapshotText(existing), value.tree)) return false;
      writeRichText(existing, value.tree);
      return true;
    }

    case "property": {
      if (value.kind !== "property" || !change.cardId || !change.fieldId) return false;
      const card = source.getCard(change.cardId);
      if (!card) return false;
      if (!allowedFieldIds(source, card).has(change.fieldId)) return false;
      // Replaying a plan must be a no-op. `setProperty` always stamps
      // `updatedAt`, which reorders the inbox, so write only a real change.
      // Every other kind below already compares first.
      const current = card.properties[change.fieldId] ?? null;
      if (same(current, value.value ?? null)) return false;
      source.setProperty(change.cardId, change.fieldId, value.value);
      return true;
    }

    case "tag": {
      if (value.kind !== "tag" || !change.cardId || !change.tagId) return false;
      const card = source.getCard(change.cardId);
      if (!card || !source.getTag(change.tagId)) return false;
      if (card.tags.includes(change.tagId) === value.present) return false;
      if (value.present) source.addCardTag(change.cardId, change.tagId);
      else source.removeCardTag(change.cardId, change.tagId);
      return true;
    }

    case "unplace": {
      if (!change.cardId || !change.boardId) return false;
      if (!source.getPlacement(change.boardId, change.cardId)) return false;
      source.unplaceCard(change.boardId, change.cardId);
      return true;
    }

    case "create-card": {
      if (value.kind !== "create-card") return false;
      const card = value.card;
      if (source.getCard(card.id)) return false;
      if (!source.getType(card.typeId)) return false;
      const placement = card.placement;
      if (placement.boardId !== change.boardId) return false;
      source.createCard({
        id: card.id,
        typeId: card.typeId,
        boardId: placement.boardId,
        position: { x: placement.x, y: placement.y },
        connectors: card.connectors,
      });
      writeRichText(source.getTitle(card.id), card.title);
      writeRichText(source.getContent(card.id), card.body);
      for (const [fieldId, value] of Object.entries(card.properties)) {
        if (value !== null) source.setProperty(card.id, fieldId, value);
      }
      for (const tagId of card.tags) source.addCardTag(card.id, tagId);
      const fields = placementFields(source, placement.boardId, card.id);
      if (fields) {
        fields.set("z", placement.z);
        if (placement.width === undefined) fields.delete("width");
        else fields.set("width", placement.width);
        if (placement.height === undefined) fields.delete("height");
        else fields.set("height", placement.height);
      }
      return true;
    }

    case "create-section": {
      if (value.kind !== "create-section") return false;
      const section = value.section;
      if (source.getSection(section.id)) return false;
      if (!source.getBoard(section.boardId)) return false;
      source.createSection({
        id: section.id,
        boardId: section.boardId,
        title: section.title,
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
        ...(section.color ? { color: section.color } : {}),
      });
      const fields = source.doc.getMap(WorkspaceDocument.SECTIONS_KEY).get(section.id);
      if (isMap(fields)) fields.set("z", section.z);
      return true;
    }

    case "create-edge": {
      if (value.kind !== "create-edge") return false;
      const edge = value.edge;
      if (source.getEdge(edge.id)) return false;
      if (!source.getBoard(edge.boardId)) return false;
      if (!source.getCard(edge.source) || !source.getCard(edge.target)) return false;
      source.setEdge(edge);
      return true;
    }

    case "placement": {
      if (value.kind !== "placement") return false;
      const placement = value.placement;
      let current = source.getPlacement(placement.boardId, placement.cardId);
      if (!current) {
        // An overwrite selection can restore a placement the workspace removed;
        // a plan never contains one the baseline did not have.
        if (!source.getCard(placement.cardId)) return false;
        source.placeCard(placement.boardId, placement.cardId, {
          x: placement.x,
          y: placement.y,
        });
        current = source.getPlacement(placement.boardId, placement.cardId);
        if (!current) return false;
      }
      let changed = false;
      if (current.x !== placement.x || current.y !== placement.y) {
        source.movePlacements(placement.boardId, [
          { cardId: placement.cardId, x: placement.x, y: placement.y },
        ]);
        changed = true;
      }
      const resized = current.width !== placement.width || current.height !== placement.height;
      if (resized) {
        if (placement.width !== undefined && placement.height !== undefined) {
          source.updatePlacementSize(placement.boardId, placement.cardId, {
            width: placement.width,
            height: placement.height,
          });
        } else {
          // A cleared dimension has no setter; the placement map is the same
          // one movePlacements writes, so this stays a layout write.
          const fields = placementFields(source, placement.boardId, placement.cardId);
          if (fields) {
            if (placement.width === undefined) fields.delete("width");
            else fields.set("width", placement.width);
            if (placement.height === undefined) fields.delete("height");
            else fields.set("height", placement.height);
          }
        }
        changed = true;
      }
      if (current.z !== placement.z) {
        const fields = placementFields(source, placement.boardId, placement.cardId);
        if (fields) {
          fields.set("z", placement.z);
          changed = true;
        }
      }
      return changed;
    }

    case "section": {
      if (value.kind !== "section") return false;
      const next = value.section;
      const current = source.getSection(next.id);
      if (!current) return false;
      let changed = false;
      if (current.title !== next.title) {
        source.renameSection(next.id, next.title);
        changed = true;
      }
      if ((current.color ?? null) !== (next.color ?? null)) {
        source.setSectionColor(next.id, next.color ?? null);
        changed = true;
      }
      if (
        current.x !== next.x ||
        current.y !== next.y ||
        current.width !== next.width ||
        current.height !== next.height
      ) {
        source.updateSectionGeometry(next.id, {
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
        });
        changed = true;
      }
      return changed;
    }

    case "edge": {
      if (value.kind === "remove-edge") {
        if (!source.getEdge(value.edgeId)) return false;
        source.removeEdge(value.edgeId);
        return true;
      }
      if (value.kind !== "edge") return false;
      const next = value.edge;
      const current = source.getEdge(next.id);
      if (!current) return false;
      const endpointsChanged =
        current.source !== next.source ||
        current.target !== next.target ||
        (current.sourceConnector ?? null) !== (next.sourceConnector ?? null) ||
        (current.targetConnector ?? null) !== (next.targetConnector ?? null);
      if (endpointsChanged) {
        // One write for both ends: reconnecting twice cannot express a swap.
        // The draft's other edge fields travel with it.
        source.setEdge(next);
        return true;
      }
      let changed = false;
      if (current.path !== next.path) {
        source.setEdgePath(next.id, next.path);
        changed = true;
      }
      if ((current.label ?? null) !== (next.label ?? null)) {
        source.setEdgeLabel(next.id, next.label ?? null);
        changed = true;
      }
      if (current.bidirectional !== next.bidirectional) {
        source.setEdgeBidirectional(next.id, next.bidirectional);
        changed = true;
      }
      return changed;
    }

    default:
      return false;
  }
}

/**
 * Applies a plan to the source workspace in one commit with `PUBLISH_ORIGIN`.
 *
 * A publish is all or nothing: a plan with conflicts or unsupported changes
 * returns 0 and writes nothing, because a partial publish would leave the draft
 * and the workspace disagreeing about the same edit. Field-level granularity is
 * preserved: unchanged values are compared before writing.
 *
 * The plan's captured values are authoritative; `draft` is only checked so a
 * draft can never be published onto itself.
 */
export function applyPublish(
  source: WorkspaceDocument,
  draft: WorkspaceDocument,
  plan: PublishPlan,
): number {
  if (source.doc === draft.doc) return 0;
  if (plan.conflicts.length > 0 || plan.unsupported.length > 0) return 0;

  const pending = plan.changes.filter((change) => plan.values[change.key] !== undefined);
  if (pending.length === 0) return 0;

  let applied = 0;
  source.batch(PUBLISH_ORIGIN, () => {
    for (const change of pending) {
      const value = plan.values[change.key];
      if (value && applyChange(source, change, value)) applied += 1;
    }
  });
  return applied;
}
