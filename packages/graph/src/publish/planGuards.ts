import { sumBy } from "remeda";
import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { utf8ByteLength } from "../publishValidation.js";
import type { Card, FieldDefinition } from "../schema.js";
import { addUnsupported } from "./changes.js";
import type {
  PublishChange,
  PublishFieldKind,
  PublishPlan,
  PublishPlanOptions,
  PublishScope,
  PublishValue,
} from "./planModel.js";
import {
  canonical,
  edgeFields,
  placementSnapshot,
  same,
  sectionFields,
  snapshotCard,
} from "./snapshot.js";

/**
 * Owns the checks a plan applies before it plans anything: which fields a share may
 * touch, the draft byte caps, conflicts, and structure the draft must keep.
 */

/** The field definition a card's type owns; the writer's own resolution rule. */
export function fieldForCard(
  workspace: WorkspaceDocument,
  card: Card,
  fieldId: string,
): FieldDefinition | undefined {
  for (const typeId of card.typeIds) {
    const field = workspace.getType(typeId)?.fields.find((entry) => entry.id === fieldId);
    if (field) return field;
  }
  return undefined;
}

function snapshotBytes(value: unknown): number {
  return utf8ByteLength(canonical(value));
}

/**
 * Approximate size of the draft a publish would project. It walks only the
 * scope being published, so an unrelated card cannot block an edit.
 */
export function draftBytes(
  draft: WorkspaceDocument,
  cardIds: readonly string[],
  boardId: string | null,
): number {
  const cards = sumBy(cardIds, (cardId) => snapshotBytes(snapshotCard(draft, cardId)));
  if (!boardId) return cards;
  let bytes = cards;
  bytes += snapshotBytes(draft.listBoardPlacements(boardId).map(placementSnapshot));
  bytes += snapshotBytes(draft.listSections(boardId).map(sectionFields));
  bytes += snapshotBytes(
    draft
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map(edgeFields),
  );
  return bytes;
}

export function cardExistsIn(source: WorkspaceDocument): (cardId: string) => boolean {
  return (cardId) => {
    const card = source.getCard(cardId);
    return card !== undefined && !card.deletedAt;
  };
}

function addConflict(
  plan: PublishPlan,
  key: string,
  kind: PublishFieldKind,
  message: string,
  label?: string,
): void {
  plan.conflicts.push({ key, kind, message, ...(label ? { label } : {}) });
}

/**
 * Records a key the draft and the workspace both changed. The draft value is
 * captured even when the key is not selected, so planning stays deterministic;
 * the change itself is only planned when `overwrite` selects the key.
 *
 * A per-block body key also honours the legacy whole-body key: a dialog that
 * still sends `card:<id>:body` keeps every block of that card.
 */
export function resolveConflict(
  plan: PublishPlan,
  options: PublishPlanOptions | undefined,
  change: PublishChange,
  value: PublishValue,
  message: string,
  label?: string,
): void {
  plan.values[change.key] = value;
  if (options?.overwrite === undefined) {
    addConflict(plan, change.key, change.kind, message, label);
    return;
  }
  if (options.overwrite.has(change.key)) {
    plan.changes.push(change);
    return;
  }
  if (change.block && change.cardId && options.overwrite.has(`card:${change.cardId}:body`)) {
    plan.changes.push(change);
  }
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

/** Fields the baseline schema defines for one card's types. */
export function allowedFieldIds(baseline: WorkspaceDocument, card: Card): Set<string> {
  const ids = new Set<string>();
  for (const typeId of card.typeIds) {
    for (const field of baseline.getType(typeId)?.fields ?? []) ids.add(field.id);
  }
  return ids;
}

/**
 * Rejects the shapes a publish may never carry: new, deleted or trashed cards,
 * and any type or tag definition edit. Everything here is reported instead of
 * ignored, because a projection looks authoritative to the draft that edits it.
 */
export function checkStructure(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  scope: PublishScope,
): boolean {
  const draftCards = new Set(draft.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  const baselineCards = new Set(baseline.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  let ok = true;

  for (const cardId of [...draftCards].sort()) {
    if (baselineCards.has(cardId)) continue;
    if (scope.scope === "board") continue; // Creation is validated by planCreations.
    addUnsupported(
      plan,
      `card:${cardId}`,
      `Card ${cardId} was created in the draft; a card share cannot create cards.`,
    );
    ok = false;
  }
  for (const cardId of [...baselineCards].sort()) {
    if (draftCards.has(cardId)) continue;
    addUnsupported(
      plan,
      `card:${cardId}`,
      `Card ${cardId} was deleted in the draft; publishing cannot delete cards.`,
    );
    ok = false;
  }
  for (const cardId of [...draftCards].sort()) {
    if (!baselineCards.has(cardId)) continue;
    const draftCard = draft.getCard(cardId);
    const baselineCard = baseline.getCard(cardId);
    if (Boolean(draftCard?.deletedAt) === Boolean(baselineCard?.deletedAt)) continue;
    addUnsupported(
      plan,
      `card:${cardId}`,
      `Card ${cardId} was trashed or restored in the draft; publishing cannot move cards to or from the trash.`,
    );
    ok = false;
  }

  const draftTypes = draft.listTypes().sort(byId);
  const baselineTypes = baseline.listTypes().sort(byId);
  if (!same(draftTypes, baselineTypes)) {
    addUnsupported(
      plan,
      "types",
      "The draft changed a type or one of its fields; publishing cannot change the schema.",
    );
    ok = false;
  }

  const draftTags = draft.listTags().sort(byId);
  const baselineTags = baseline.listTags().sort(byId);
  if (!same(draftTags, baselineTags)) {
    addUnsupported(
      plan,
      "tags",
      "The draft changed a tag definition; publishing cannot create, delete or rename tags.",
    );
    ok = false;
  }

  return ok;
}
