import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { propertyValueError } from "../property.js";
import { richTextBytes, validateRichTextTree } from "../publishValidation.js";
import { alignBlocks, blockLabel, bodyBlockKey, readBodyBlocks } from "./blocks.js";
import { addUnsupported, record } from "./changes.js";
import type { PublishLimits } from "./limits.js";
import { allowedFieldIds, cardExistsIn, fieldForCard, resolveConflict } from "./planGuards.js";
import type { PublishChange, PublishPlan, PublishPlanOptions, PublishValue } from "./planModel.js";
import { type RichTextSnapshot, same, snapshotCard } from "./snapshot.js";

/**
 * Owns planning for one card: its title, body, properties and tags, comparing draft,
 * baseline and source.
 */

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

export function planCard(
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
