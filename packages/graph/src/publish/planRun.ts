import { Result } from "neverthrow";
import type { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { addUnsupported } from "./changes.js";
import { planCreations } from "./creations.js";
import { type PublishLimits, resolvePublishLimits } from "./limits.js";
import { planCard } from "./planCards.js";
import { checkStructure, draftBytes } from "./planGuards.js";
import { planEdges, planPlacements, planSections } from "./planLayout.js";
import type { PublishPlan, PublishPlanOptions, PublishScope } from "./planModel.js";

/**
 * Owns the planning entry point: it seeds a plan, applies the guards, then hands the
 * draft, baseline and source to each planner.
 */

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
  // A malformed value in the draft is a reported limit of the share, not a
  // crash: the planners read parsed records, so a schema failure surfaces here.
  const planned = Result.fromThrowable(
    () => planPublishInto(plan, draft, baseline, source, scope, options, limits),
    (error) => (error instanceof Error ? error.message : String(error)),
  )();
  if (planned.isErr()) {
    plan.changes = [];
    plan.conflicts = [];
    plan.values = {};
    addUnsupported(
      plan,
      "publish:malformed",
      `The draft contains a malformed value and cannot be published (${planned.error}).`,
    );
  }
  return plan;
}
