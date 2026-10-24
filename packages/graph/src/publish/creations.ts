/**
 * Owns new cards, sections and edges: `planCreations`, the id checks and the
 * labels a creation dialog shows. A creation is an explicit change, never a
 * relaxed edit, so every check here asks what a board share may add.
 *
 * It must never apply anything and must never turn a failed creation into an
 * edit of an entity that already holds the same id: a rejected creation is
 * reported, never downgraded.
 */

import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import { propertyValueError } from "../property.js";
import {
  edgeIssue,
  placementIssue,
  richTextBytes,
  sectionIssue,
  validateRichTextTree,
} from "../publishValidation.js";
import type { GraphEdge, Section } from "../schema.js";
import { addUnsupported, record } from "./changes.js";
import type { PublishLimits } from "./limits.js";
import type { PublishPlan, PublishScope } from "./plan.js";
import { placementSnapshot, snapshotCard } from "./snapshot.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isCanonicalUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function cardLabel(draft: WorkspaceDocument, cardId: string): string {
  const title = draft.displayTitle(cardId).trim();
  return title.length > 0 ? `Card "${title}"` : "Untitled card";
}

function sectionLabel(section: Section): string {
  return section.title.trim().length > 0 ? `Section "${section.title}"` : "Untitled section";
}

function edgeLabel(edge: GraphEdge): string {
  return edge.label?.trim() ? `Edge "${edge.label}"` : `Edge ${edge.source} to ${edge.target}`;
}

/** New cards, sections and edges are explicit creation changes, never relaxed edits. */
export function planCreations(
  plan: PublishPlan,
  draft: WorkspaceDocument,
  baseline: WorkspaceDocument,
  source: WorkspaceDocument,
  scope: PublishScope,
  limits: PublishLimits,
): void {
  if (scope.scope !== "board") return;
  const boardId = scope.boardId;
  const sourceBoard = source.getView(boardId);
  const draftCards = new Set(draft.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  const baselineCards = new Set(baseline.doc.getMap(WorkspaceDocument.CARDS_KEY).keys());
  const baselineSections = new Set(baseline.listSections(boardId).map((section) => section.id));
  const baselineEdges = new Set(
    baseline
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => edge.id),
  );
  const draftCardsById = new Set([...draftCards]);
  const isCardLive = (cardId: string) =>
    Boolean(source.getPlacement(boardId, cardId) || draftCardsById.has(cardId));

  if (!sourceBoard) {
    const hasNewCards = [...draftCards].some((id) => !baselineCards.has(id));
    const hasNewSections = draft
      .listSections(boardId)
      .some((section) => !baselineSections.has(section.id));
    const hasNewEdges = draft
      .listEdges()
      .some((edge) => edge.boardId === boardId && !baselineEdges.has(edge.id));
    if (hasNewCards || hasNewSections || hasNewEdges) {
      addUnsupported(
        plan,
        `board:${boardId}:create`,
        "The shared board no longer exists in the workspace.",
      );
    }
    return;
  }

  for (const cardId of [...draftCards].filter((id) => !baselineCards.has(id)).sort()) {
    const label = cardLabel(draft, cardId);
    const key = `card:${cardId}:create`;
    if (!isCanonicalUuid(cardId)) {
      addUnsupported(plan, key, "A new card id is not a canonical UUID.", label);
      continue;
    }
    if (source.getCard(cardId)) {
      addUnsupported(
        plan,
        key,
        "A card with this id already exists in the workspace; the draft reused it.",
        label,
      );
      continue;
    }
    const card = draft.getCard(cardId);
    if (!card || card.deletedAt) {
      addUnsupported(plan, key, "The new card is missing or trashed in the draft.", label);
      continue;
    }
    if (card.typeIds.length !== 1 || card.primaryTypeId !== card.typeIds[0]) {
      addUnsupported(plan, key, "A new card must have exactly one primary type.", label);
      continue;
    }
    const type = source.getType(card.primaryTypeId);
    if (!type) {
      addUnsupported(
        plan,
        key,
        `The type "${card.primaryTypeId}" no longer exists in the workspace.`,
        label,
      );
      continue;
    }
    const placements = draft.listCardPlacements(cardId);
    if (placements.length !== 1 || placements[0]?.boardId !== boardId) {
      addUnsupported(
        plan,
        key,
        "A new card must be placed on the shared board and nowhere else.",
        label,
      );
      continue;
    }
    const placement = placements[0];
    if (!placement) {
      addUnsupported(plan, key, "The new card has no placement.", label);
      continue;
    }
    const placementProblem = placementIssue(placementSnapshot(placement), limits);
    if (placementProblem) {
      addUnsupported(plan, key, placementProblem, label);
      continue;
    }
    const snapshot = snapshotCard(draft, cardId);
    if (!snapshot) {
      addUnsupported(plan, key, "The new card could not be read.", label);
      continue;
    }
    const textBytes = richTextBytes(snapshot.title) + richTextBytes(snapshot.body);
    if (textBytes > limits.maxCardTextBytes) {
      addUnsupported(
        plan,
        key,
        `The new card holds ${textBytes} bytes of text; the per-card limit is ${limits.maxCardTextBytes}.`,
        label,
      );
      continue;
    }
    const titleProblem = validateRichTextTree(snapshot.title, limits);
    if (titleProblem) {
      addUnsupported(plan, key, titleProblem, label);
      continue;
    }
    const bodyProblem = validateRichTextTree(snapshot.body, limits);
    if (bodyProblem) {
      addUnsupported(plan, key, bodyProblem, label);
      continue;
    }
    for (const [fieldId, value] of Object.entries(snapshot.properties)) {
      const field = type.fields.find((entry) => entry.id === fieldId);
      if (!field) {
        addUnsupported(plan, key, `Field "${fieldId}" is not part of type "${type.name}".`, label);
        break;
      }
      const problem = propertyValueError(field, value, {
        cardId,
        cardExists: (target) => target !== cardId && isCardLive(target),
      });
      if (problem) {
        addUnsupported(plan, key, problem, label);
        break;
      }
    }
    if (plan.unsupported.some((entry) => entry.key === key)) continue;
    for (const tagId of snapshot.tags) {
      if (source.getTag(tagId)) continue;
      addUnsupported(plan, key, `Tag "${tagId}" no longer exists in the workspace.`, label);
      break;
    }
    if (plan.unsupported.some((entry) => entry.key === key)) continue;
    record(
      plan,
      { key, kind: "create-card", cardId, boardId },
      {
        kind: "create-card",
        card: {
          id: cardId,
          typeId: card.primaryTypeId,
          title: snapshot.title,
          body: snapshot.body,
          properties: snapshot.properties,
          tags: snapshot.tags,
          connectors: card.connectors,
          placement: placementSnapshot(placement),
        },
      },
    );
  }

  const sourceSections = new Set(source.listSections(boardId).map((section) => section.id));
  for (const section of draft.listSections(boardId)) {
    if (baselineSections.has(section.id)) continue;
    const key = `section:${section.id}:create`;
    const label = sectionLabel(section);
    if (!isCanonicalUuid(section.id)) {
      addUnsupported(plan, key, "A new section id is not a canonical UUID.", label);
      continue;
    }
    if (sourceSections.has(section.id)) {
      addUnsupported(plan, key, "A section with this id already exists in the workspace.", label);
      continue;
    }
    const problem = sectionIssue(section, limits);
    if (problem) {
      addUnsupported(plan, key, problem, label);
      continue;
    }
    record(
      plan,
      { key, kind: "create-section", sectionId: section.id, boardId },
      {
        kind: "create-section",
        section,
      },
    );
  }

  const sourceEdges = new Set(
    source
      .listEdges()
      .filter((edge) => edge.boardId === boardId)
      .map((edge) => edge.id),
  );
  for (const edge of draft.listEdges().filter((entry) => entry.boardId === boardId)) {
    if (baselineEdges.has(edge.id)) continue;
    const key = `edge:${edge.id}:create`;
    const label = edgeLabel(edge);
    if (!isCanonicalUuid(edge.id)) {
      addUnsupported(plan, key, "A new edge id is not a canonical UUID.", label);
      continue;
    }
    if (sourceEdges.has(edge.id)) {
      addUnsupported(plan, key, "An edge with this id already exists in the workspace.", label);
      continue;
    }
    const problem = edgeIssue(edge, limits, { isCardLive });
    if (problem) {
      addUnsupported(plan, key, problem, label);
      continue;
    }
    record(
      plan,
      { key, kind: "create-edge", edgeId: edge.id, boardId },
      {
        kind: "create-edge",
        edge,
      },
    );
  }
}
