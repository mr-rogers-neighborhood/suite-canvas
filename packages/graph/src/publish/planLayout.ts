import { unique } from "remeda";
import type { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { edgeIssue, placementIssue, sectionIssue } from "../publishValidation.js";
import { addUnsupported, record } from "./changes.js";
import type { PublishLimits } from "./limits.js";
import { cardExistsIn, resolveConflict } from "./planGuards.js";
import type { PublishPlan, PublishPlanOptions } from "./planModel.js";
import { edgeFields, placementSnapshot, same, sectionFields } from "./snapshot.js";

/**
 * Owns planning for the board's shape: placements, sections and edges, each comparing
 * draft, baseline and source.
 */

export function planPlacements(
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

export function planSections(
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

  const ids = unique([...draftSections.keys(), ...baselineSections.keys()]);
  for (const sectionId of ids.toSorted()) {
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

export function planEdges(
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

  const ids = unique([...draftEdges.keys(), ...baselineEdges.keys()]);
  for (const edgeId of ids.toSorted()) {
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
