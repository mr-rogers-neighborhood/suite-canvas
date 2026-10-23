/**
 * Owns planning: `planPublish`, the per-kind planners comparing draft, baseline
 * and source, the `PublishPlan` types they produce, and the helpers that record
 * changes, conflicts and unsupported keys.
 *
 * Planning is the only place that validates and the only place that decides
 * what a difference means, and it must never write to any document: a plan is
 * pure and replayable. Apply reads only the captured values, so a check skipped
 * here becomes an unvalidated value replayed there.
 */

import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { propertyValueError } from "../property.js";
import {
  edgeIssue,
  placementIssue,
  richTextBytes,
  sectionIssue,
  utf8ByteLength,
  validateRichTextTree,
} from "../publishValidation.js";
import type { Card, FieldDefinition, GraphEdge, PropertyValue, Section } from "../schema.js";
import {
  alignBlocks,
  type BlockTarget,
  blockLabel,
  bodyBlockKey,
  readBodyBlocks,
} from "./blocks.js";
import { addUnsupported, record } from "./changes.js";
import { planCreations } from "./creations.js";
import { type PublishLimits, resolvePublishLimits } from "./limits.js";
import {
  canonical,
  edgeFields,
  type PlacementSnapshot,
  placementSnapshot,
  type RichTextSnapshot,
  same,
  sectionFields,
  snapshotCard,
} from "./snapshot.js";

/** What a share link may publish: one board, or one card. */
export type PublishScope = { scope: "board"; boardId: string } | { scope: "card"; cardId: string };

/** The kinds of change an editor share may publish. */
export type PublishFieldKind =
  | "title"
  | "body"
  | "property"
  | "tag"
  | "placement"
  | "unplace"
  | "section"
  | "edge"
  | "create-card"
  | "create-section"
  | "create-edge";

export interface PublishConflict {
  /** Stable key, e.g. `card:<id>:title`, `board:<id>:card:<id>`, `section:<id>`. */
  key: string;
  kind: PublishFieldKind | "unsupported";
  message: string;
  /** Human label for the dialog; ids stay in the key only. */
  label?: string;
}

export interface PublishChange {
  key: string;
  kind: PublishFieldKind;
  /** Optional details for reporting; apply() never reads them. */
  cardId?: string;
  fieldId?: string;
  tagId?: string;
  boardId?: string;
  sectionId?: string;
  edgeId?: string;
  /** Set on a `body` change that publishes one block instead of the body. */
  block?: BlockTarget;
}

/** A new card captured from the draft, including its required board placement. */
export interface CreatedCardSnapshot {
  id: string;
  typeId: string;
  title: RichTextSnapshot;
  body: RichTextSnapshot;
  properties: Record<string, PropertyValue | null>;
  tags: string[];
  connectors: Card["connectors"];
  placement: PlacementSnapshot;
}

/** The value a change carries, captured from the draft at planning time. */
export type PublishValue =
  | { kind: "text"; tree: RichTextSnapshot }
  | { kind: "body-block"; op: "replace"; block: RichTextSnapshot }
  | { kind: "body-block"; op: "insert"; block: RichTextSnapshot }
  | { kind: "body-block"; op: "remove" }
  | { kind: "property"; value: PropertyValue | null }
  | { kind: "tag"; present: boolean }
  | { kind: "placement"; placement: PlacementSnapshot }
  | { kind: "unplace" }
  | { kind: "section"; section: Section }
  | { kind: "edge"; edge: GraphEdge }
  | { kind: "remove-edge"; edgeId: string }
  | { kind: "create-card"; card: CreatedCardSnapshot }
  | { kind: "create-section"; section: Section }
  | { kind: "create-edge"; edge: GraphEdge };

/**
 * How a caller resolves keys that the draft and the workspace both changed.
 * With `overwrite`, such a key is no longer a conflict: a selected key
 * publishes the draft value, an unselected one keeps the workspace value.
 * Without `overwrite`, every conflicting key rejects the publish.
 */
export interface PublishPlanOptions {
  overwrite?: ReadonlySet<string>;
  /**
   * Overrides the byte and geometry caps a publish enforces. Unset limits fall
   * back to the environment overrides and `DEFAULT_PUBLISH_LIMITS`.
   */
  limits?: Partial<PublishLimits>;
}

export interface PublishPlan {
  scope: PublishScope;
  /** Changes the draft made that the source still matches. */
  changes: PublishChange[];
  /** Keys the draft and the source both changed; a publish is rejected. */
  conflicts: PublishConflict[];
  /** Keys outside what an editor share may publish; a publish is rejected. */
  unsupported: PublishConflict[];
  /**
   * The exact draft values captured when planning, keyed by change key. Apply
   * reads only these, never the live draft, so a plan stays deterministic.
   */
  values: Record<string, PublishValue>;
}

/** The field definition a card's type owns; the writer's own resolution rule. */
function fieldForCard(
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
function draftBytes(
  draft: WorkspaceDocument,
  cardIds: readonly string[],
  boardId: string | null,
): number {
  let bytes = 0;
  for (const cardId of cardIds) bytes += snapshotBytes(snapshotCard(draft, cardId));
  if (!boardId) return bytes;
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

function cardExistsIn(source: WorkspaceDocument): (cardId: string) => boolean {
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
function resolveConflict(
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
function checkStructure(
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

/**
 * Plans a card body block by block.
 *
 * The baseline is the reference: a block the draft changed keeps the baseline
 * block's key, so a peer that changed the same block lands on the same key and
 * conflicts. Blocks only one side touched are applied as that side left them,
 * and blocks only one side has are inserted or removed.
 *
 * When the blocks cannot be lined up at all — a reorder, or two changes that
 * would need the same key — the card degrades to one whole-body conflict. That
 * is deliberate: guessing which block moved where silently loses text, and a
 * conflict the editor can see is always cheaper than a lost paragraph.
 */
function planBody(
  plan: PublishPlan,
  cardId: string,
  cardTitle: string,
  draftBody: RichTextSnapshot,
  baselineBody: RichTextSnapshot,
  sourceBody: RichTextSnapshot | undefined,
  baseline: WorkspaceDocument,
  draft: WorkspaceDocument,
  source: WorkspaceDocument,
  options: PublishPlanOptions | undefined,
): void {
  const draftBlocks = readBodyBlocks(draft, cardId);
  const baselineBlocks = readBodyBlocks(baseline, cardId);
  const sourceBlocks = sourceBody === undefined ? null : readBodyBlocks(source, cardId);

  const wholeKey = `card:${cardId}:body`;
  const whole: PublishChange = { key: wholeKey, kind: "body", cardId };
  const wholeValue: PublishValue = { kind: "text", tree: draftBody };
  const wholeMessage = `The body of card ${cardId} changed in the workspace after this draft was taken.`;
  const wholeLabel = `${cardTitle} \u00b7 body`;

  const blocks = Math.max(draftBlocks.length, baselineBlocks.length, sourceBlocks?.length ?? 0);
  // A body of one block is the whole body: keep the legacy key and the legacy
  // whole-body write, so a single-paragraph card publishes exactly as before.
  if (sourceBlocks === null || blocks <= 1) {
    if (sourceBody !== undefined && same(sourceBody, baselineBody)) {
      record(plan, whole, wholeValue);
      return;
    }
    resolveConflict(plan, options, whole, wholeValue, wholeMessage, wholeLabel);
    return;
  }

  const draftAlign = alignBlocks(baselineBlocks, draftBlocks);
  const sourceAlign = alignBlocks(baselineBlocks, sourceBlocks);

  interface PlannedBlock {
    change: PublishChange;
    value: PublishValue;
    label: string;
    message: string;
    /** Whether the workspace changed the same block since the baseline. */
    conflicting: boolean;
  }

  const planned: PlannedBlock[] = [];

  for (let index = 0; index < baselineBlocks.length; index += 1) {
    const base = baselineBlocks[index];
    if (!base) continue;
    const draftIndex = draftAlign.matches[index] ?? -1;
    const sourceIndex = sourceAlign.matches[index] ?? -1;
    const draftBlock = draftIndex >= 0 ? draftBlocks[draftIndex] : undefined;
    const sourceBlock = sourceIndex >= 0 ? sourceBlocks[sourceIndex] : undefined;
    if (draftBlock && same(draftBlock.tree, base.tree)) continue;
    const label = blockLabel(cardTitle, base.nodeName, base.text);
    planned.push({
      change: {
        key: bodyBlockKey(cardId, base),
        kind: "body",
        cardId,
        block: { key: base.key, index, nodeName: base.nodeName, after: null },
      },
      value: draftBlock
        ? { kind: "body-block", op: "replace", block: draftBlock.tree }
        : { kind: "body-block", op: "remove" },
      label,
      message: `This ${base.nodeName} changed in the workspace after this draft was taken.`,
      conflicting: !sourceBlock || !same(sourceBlock.tree, base.tree),
    });
  }

  for (const draftIndex of draftAlign.added) {
    const block = draftBlocks[draftIndex];
    if (!block) continue;
    // The workspace already holds this exact block: both sides added it, and a
    // second insert would duplicate it.
    if (sourceBlocks.some((candidate) => candidate.key === block.key)) continue;
    const previous = draftIndex > 0 ? draftBlocks[draftIndex - 1] : undefined;
    planned.push({
      change: {
        key: bodyBlockKey(cardId, block),
        kind: "body",
        cardId,
        block: {
          key: block.key,
          index: draftIndex,
          nodeName: block.nodeName,
          after: previous?.key ?? null,
        },
      },
      value: { kind: "body-block", op: "insert", block: block.tree },
      label: blockLabel(cardTitle, block.nodeName, block.text),
      message: `This ${block.nodeName} is new in the draft.`,
      conflicting: false,
    });
  }

  const keys = new Set(planned.map((entry) => entry.change.key));
  if (draftAlign.reordered || sourceAlign.reordered || keys.size !== planned.length) {
    resolveConflict(
      plan,
      options,
      whole,
      wholeValue,
      `The body of card ${cardId} changed in the workspace after this draft was taken and its blocks no longer line up; publishing keeps one whole version of the body.`,
      wholeLabel,
    );
    return;
  }

  for (const entry of planned) {
    if (!entry.conflicting) {
      record(plan, entry.change, entry.value);
      continue;
    }
    resolveConflict(plan, options, entry.change, entry.value, entry.message, entry.label);
  }
}

function planCard(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  cardId: string,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  const draftCard = draft.getCard(cardId);
  const baselineCard = baseline.getCard(cardId);
  if (!draftCard || !baselineCard) return;

  if (
    !same(draftCard.typeIds, baselineCard.typeIds) ||
    draftCard.primaryTypeId !== baselineCard.primaryTypeId
  ) {
    addUnsupported(
      plan,
      `card:${cardId}:type`,
      `The type of card ${cardId} changed in the draft; publishing cannot change a card's type.`,
    );
  }

  const baselineTagIds = new Set(baseline.doc.getMap(WorkspaceDocument.TAGS_KEY).keys());
  for (const tagId of [...draftCard.tags].sort()) {
    if (baselineTagIds.has(tagId)) continue;
    addUnsupported(
      plan,
      `card:${cardId}:tag:${tagId}`,
      `Tag ${tagId} is not part of the shared workspace; publishing cannot create tags.`,
    );
  }

  const fieldIds = allowedFieldIds(baseline, baselineCard);
  for (const fieldId of Object.keys(draftCard.properties).sort()) {
    if (fieldIds.has(fieldId)) continue;
    addUnsupported(
      plan,
      `card:${cardId}:field:${fieldId}`,
      `Field ${fieldId} is not part of the shared schema; publishing cannot add fields.`,
    );
  }

  const draftSnapshot = snapshotCard(draft, cardId);
  const baselineSnapshot = snapshotCard(baseline, cardId);
  const sourceSnapshot = snapshotCard(source, cardId);
  if (!draftSnapshot || !baselineSnapshot) return;

  let textChanged = false;
  {
    const key = `card:${cardId}:title`;
    const draftValue = draftSnapshot.title;
    const baselineValue = baselineSnapshot.title;
    if (!same(draftValue, baselineValue)) {
      // A draft can be written past the editor schema; a publish may not replay it.
      const issue = validateRichTextTree(draftValue, limits);
      if (issue) {
        addUnsupported(plan, key, `The title of card ${cardId} cannot be published: ${issue}.`);
      } else {
        textChanged = true;
        if (sourceSnapshot && same(sourceSnapshot.title, baselineValue)) {
          record(plan, { key, kind: "title", cardId }, { kind: "text", tree: draftValue });
        } else {
          resolveConflict(
            plan,
            options,
            { key, kind: "title", cardId },
            { kind: "text", tree: draftValue },
            `The title of card ${cardId} changed in the workspace after this draft was taken.`,
          );
        }
      }
    }
  }

  const bodyKey = `card:${cardId}:body`;
  if (!same(draftSnapshot.body, baselineSnapshot.body)) {
    const issue = validateRichTextTree(draftSnapshot.body, limits);
    if (issue) {
      addUnsupported(plan, bodyKey, `The body of card ${cardId} cannot be published: ${issue}.`);
    } else {
      textChanged = true;
      planBody(
        plan,
        cardId,
        baseline.displayTitle(cardId),
        draftSnapshot.body,
        baselineSnapshot.body,
        sourceSnapshot?.body,
        baseline,
        draft,
        source,
        options,
      );
    }
  }
  if (textChanged) {
    const bytes = richTextBytes(draftSnapshot.title) + richTextBytes(draftSnapshot.body);
    if (bytes > limits.maxCardTextBytes) {
      addUnsupported(
        plan,
        `card:${cardId}:text`,
        `Card ${cardId} holds ${bytes} bytes of text; the publish limit is ${limits.maxCardTextBytes} bytes.`,
      );
    }
  }

  const propertyIds = new Set([
    ...Object.keys(draftSnapshot.properties),
    ...Object.keys(baselineSnapshot.properties),
  ]);
  for (const fieldId of [...propertyIds].sort()) {
    // A field the draft invented is already reported as unsupported.
    if (!fieldIds.has(fieldId)) continue;
    const draftValue = draftSnapshot.properties[fieldId] ?? null;
    const baselineValue = baselineSnapshot.properties[fieldId] ?? null;
    if (same(draftValue, baselineValue)) continue;
    const key = `card:${cardId}:field:${fieldId}`;
    // The draft may hold a value no writer would accept; report it instead of
    // replaying it, because apply reads only what the plan captured.
    const field = fieldForCard(baseline, baselineCard, fieldId);
    const issue = field
      ? propertyValueError(field, draftValue, {
          cardId,
          cardExists: cardExistsIn(source),
        })
      : `Field ${fieldId} is missing from the shared schema`;
    if (issue) {
      addUnsupported(plan, key, `${issue}; the draft value cannot be published.`);
      continue;
    }
    const sourceValue = sourceSnapshot?.properties[fieldId] ?? null;
    if (!sourceSnapshot || !same(sourceValue, baselineValue)) {
      resolveConflict(
        plan,
        options,
        { key, kind: "property", cardId, fieldId },
        { kind: "property", value: draftValue },
        `Field ${fieldId} of card ${cardId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(
      plan,
      { key, kind: "property", cardId, fieldId },
      { kind: "property", value: draftValue },
    );
  }

  const tagIds = new Set([...draftSnapshot.tags, ...baselineSnapshot.tags]);
  for (const tagId of [...tagIds].sort()) {
    if (!baselineTagIds.has(tagId)) continue;
    const present = draftSnapshot.tags.includes(tagId);
    if (present === baselineSnapshot.tags.includes(tagId)) continue;
    const key = `card:${cardId}:tag:${tagId}`;
    const sourcePresent = sourceSnapshot?.tags.includes(tagId) ?? false;
    if (!sourceSnapshot || sourcePresent !== baselineSnapshot.tags.includes(tagId)) {
      resolveConflict(
        plan,
        options,
        { key, kind: "tag", cardId, tagId },
        { kind: "tag", present },
        `Tag ${tagId} on card ${cardId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(plan, { key, kind: "tag", cardId, tagId }, { kind: "tag", present });
  }
}

function planPlacements(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  boardId: string,
  cardIds: readonly string[],
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  for (const cardId of cardIds) {
    const key = `board:${boardId}:card:${cardId}`;
    const draftPlacement = draft.getPlacement(boardId, cardId);
    const baselinePlacement = baseline.getPlacement(boardId, cardId);
    const draftSnapshot = draftPlacement ? placementSnapshot(draftPlacement) : undefined;
    const baselineSnapshot = baselinePlacement ? placementSnapshot(baselinePlacement) : undefined;
    const sourcePlacement = source.getPlacement(boardId, cardId);
    const sourceSnapshot = sourcePlacement ? placementSnapshot(sourcePlacement) : undefined;

    if (draftSnapshot && !baselineSnapshot) {
      // A brand-new draft card carries its own placement in the creation change.
      if (!source.getCard(cardId)) continue;
      addUnsupported(
        plan,
        key,
        `Card ${cardId} was placed on this board by the draft; publishing cannot add placements for cards that were not already on the board.`,
      );
      continue;
    }
    if (!draftSnapshot) {
      if (!baselineSnapshot) continue;
      if (!sourceSnapshot || !same(sourceSnapshot, baselineSnapshot)) {
        resolveConflict(
          plan,
          options,
          { key, kind: "unplace", cardId, boardId },
          { kind: "unplace" },
          `Card ${cardId} was moved or removed on this board in the workspace after this draft was taken.`,
        );
        continue;
      }
      record(plan, { key, kind: "unplace", cardId, boardId }, { kind: "unplace" });
      continue;
    }
    if (!baselineSnapshot) continue;
    if (same(draftSnapshot, baselineSnapshot)) continue;
    const issue = placementIssue(draftSnapshot, limits);
    if (issue) {
      addUnsupported(plan, key, issue);
      continue;
    }
    if (!sourceSnapshot || !same(sourceSnapshot, baselineSnapshot)) {
      resolveConflict(
        plan,
        options,
        { key, kind: "placement", cardId, boardId },
        { kind: "placement", placement: draftSnapshot },
        `Card ${cardId} was moved or resized on this board in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(
      plan,
      { key, kind: "placement", cardId, boardId },
      { kind: "placement", placement: draftSnapshot },
    );
  }
}

function planSections(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  boardId: string,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  const draftSections = new Map(
    draft.listSections(boardId).map((section) => [section.id, section]),
  );
  const baselineSections = new Map(
    baseline.listSections(boardId).map((section) => [section.id, section]),
  );
  const sourceSections = new Map(
    source.listSections(boardId).map((section) => [section.id, section]),
  );

  const ids = new Set([...draftSections.keys(), ...baselineSections.keys()]);
  for (const sectionId of [...ids].sort()) {
    const key = `section:${sectionId}`;
    const draftSection = draftSections.get(sectionId);
    const baselineSection = baselineSections.get(sectionId);
    if (draftSection && !baselineSection) continue; // Creation is validated by planCreations.
    if (!draftSection) {
      addUnsupported(
        plan,
        key,
        `Section ${sectionId} was deleted in the draft; publishing cannot delete sections.`,
      );
      continue;
    }
    if (!baselineSection) continue;
    const draftValue = sectionFields(draftSection);
    if (same(draftValue, sectionFields(baselineSection))) continue;
    const issue = sectionIssue(draftSection, limits);
    if (issue) {
      addUnsupported(plan, key, issue);
      continue;
    }
    const sourceSection = sourceSections.get(sectionId);
    if (!sourceSection || !same(sectionFields(sourceSection), sectionFields(baselineSection))) {
      resolveConflict(
        plan,
        options,
        { key, kind: "section", sectionId, boardId },
        { kind: "section", section: draftSection },
        `Section ${sectionId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(
      plan,
      { key, kind: "section", sectionId, boardId },
      { kind: "section", section: draftSection },
    );
  }
}

function planEdges(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  boardId: string,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  // Raw edges, not `listBoardEdges`: that view drops an arrow when an endpoint
  // is unplaced, and unplacing a card must not read as deleting its arrows.
  const draftEdges = new Map(
    draft
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => [edge.id, edge]),
  );
  const baselineEdges = new Map(
    baseline
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => [edge.id, edge]),
  );
  const sourceEdges = new Map(
    source
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => [edge.id, edge]),
  );

  const ids = new Set([...draftEdges.keys(), ...baselineEdges.keys()]);
  for (const edgeId of [...ids].sort()) {
    const key = `edge:${edgeId}`;
    const draftEdge = draftEdges.get(edgeId);
    const baselineEdge = baselineEdges.get(edgeId);
    if (draftEdge && !baselineEdge) continue; // Creation is validated by planCreations.
    if (!draftEdge) {
      if (!baselineEdge) continue;
      const sourceEdge = sourceEdges.get(edgeId);
      if (!same(edgeFields(sourceEdge), edgeFields(baselineEdge))) {
        resolveConflict(
          plan,
          options,
          { key, kind: "edge", edgeId, boardId },
          { kind: "remove-edge", edgeId },
          `Edge ${edgeId} changed in the workspace after this draft was taken.`,
        );
        continue;
      }
      record(plan, { key, kind: "edge", edgeId, boardId }, { kind: "remove-edge", edgeId });
      continue;
    }
    if (!baselineEdge) continue;
    if (draftEdge.kind !== baselineEdge.kind) {
      addUnsupported(
        plan,
        key,
        `Edge ${edgeId} changed kind in the draft; publishing cannot change what an arrow means.`,
      );
      continue;
    }
    if (same(edgeFields(draftEdge), edgeFields(baselineEdge))) continue;
    const issue = edgeIssue(draftEdge, limits, {
      isCardLive: cardExistsIn(source),
    });
    if (issue) {
      addUnsupported(plan, key, issue);
      continue;
    }
    const sourceEdge = sourceEdges.get(edgeId);
    if (!same(edgeFields(sourceEdge), edgeFields(baselineEdge))) {
      resolveConflict(
        plan,
        options,
        { key, kind: "edge", edgeId, boardId },
        { kind: "edge", edge: draftEdge },
        `Edge ${edgeId} changed in the workspace after this draft was taken.`,
      );
      continue;
    }
    record(plan, { key, kind: "edge", edgeId, boardId }, { kind: "edge", edge: draftEdge });
  }
}

function planPublishInto(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  scope: PublishScope,
  options: PublishPlanOptions | undefined,
  limits: PublishLimits,
): void {
  if (!checkStructure(plan, draft, baseline, scope)) return;

  if (scope.scope === "card") {
    const cardId = scope.cardId;
    const draftCard = draft.getCard(cardId);
    const baselineCard = baseline.getCard(cardId);
    if (!draftCard || draftCard.deletedAt) {
      addUnsupported(plan, `card:${cardId}`, `Card ${cardId} is missing or trashed in the draft.`);
      return;
    }
    if (!baselineCard || baselineCard.deletedAt) {
      addUnsupported(
        plan,
        `card:${cardId}`,
        `Card ${cardId} is missing or trashed in the baseline.`,
      );
      return;
    }
    const bytes = draftBytes(draft, [cardId], null);
    if (bytes > limits.maxDraftBytes) {
      addUnsupported(
        plan,
        "publish:size",
        `The draft holds ${bytes} bytes; publishing is limited to ${limits.maxDraftBytes} bytes.`,
      );
      return;
    }
    planCard(plan, draft, baseline, source, cardId, options, limits);
    return;
  }

  const boardId = scope.boardId;
  const draftPlacements = draft.listBoardPlacements(boardId);
  const baselinePlacements = baseline.listBoardPlacements(boardId);
  const cardIds = [
    ...new Set([
      ...draftPlacements.map((placement) => placement.cardId),
      ...baselinePlacements.map((placement) => placement.cardId),
    ]),
  ].sort();

  const bytes = draftBytes(draft, cardIds, boardId);
  if (bytes > limits.maxDraftBytes) {
    addUnsupported(
      plan,
      "publish:size",
      `The draft holds ${bytes} bytes; publishing is limited to ${limits.maxDraftBytes} bytes.`,
    );
    return;
  }

  for (const cardId of cardIds) planCard(plan, draft, baseline, source, cardId, options, limits);
  planPlacements(plan, draft, baseline, source, boardId, cardIds, options, limits);
  planSections(plan, draft, baseline, source, boardId, options, limits);
  planEdges(plan, draft, baseline, source, boardId, options, limits);
  planCreations(plan, draft, baseline, source, scope, limits);
}

/**
 * Computes what a publish would do. Pure: it only reads the three documents.
 *
 * The draft is authoritative only where it differs from the baseline. A key the
 * source changed since the baseline and the draft also changed is a conflict;
 * a key only the source changed keeps the source value and is not a change.
 *
 * `options.overwrite` resolves those conflicts: a selected key publishes the
 * draft value, an unselected one keeps the source value. Unsupported changes
 * reject the publish either way.
 *
 * Every drafted value is validated against the field schema, the editor's rich
 * text schema and the geometry caps before it can be captured. A value the
 * reader cannot even parse is reported as unsupported, so a malformed draft
 * fails closed instead of throwing or partially applying.
 */
export function planPublish(
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  scope: PublishScope,
  options?: PublishPlanOptions,
): PublishPlan {
  const plan: PublishPlan = {
    scope,
    changes: [],
    conflicts: [],
    unsupported: [],
    values: {},
  };
  const limits = resolvePublishLimits(options?.limits);
  try {
    planPublishInto(plan, draft, baseline, source, scope, options, limits);
  } catch (error) {
    plan.changes = [];
    plan.conflicts = [];
    plan.values = {};
    addUnsupported(
      plan,
      "publish:malformed",
      `The draft contains a malformed value and cannot be published (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  return plan;
}
