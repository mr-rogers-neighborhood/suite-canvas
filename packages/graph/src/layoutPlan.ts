import { z } from "zod";
import { MAX_PUBLISH_COORDINATE } from "./publishValidation.js";
import { entityIdSchema } from "./schema.js";

/**
 * A layout plan is a one-shot proposal: the canvas previews it, then applies it
 * through `WorkspaceDocument.applyLayoutPlan`, which lands every write in one
 * batch (one undo step). Nothing in this module reads or writes Loro.
 */

export const LAYOUT_APPLY_ORIGIN = "layout:apply";

/** Same bound publishes enforce; larger finite coordinates are clamped to it. */
export const MAX_LAYOUT_COORDINATE = MAX_PUBLISH_COORDINATE;

/** Minimum section sizes, matching `updateSectionGeometry`. */
export const MIN_LAYOUT_SECTION_WIDTH = 80;
export const MIN_LAYOUT_SECTION_HEIGHT = 60;

export interface LayoutPlanSize {
  readonly width: number;
  readonly height: number;
}

/**
 * One placement write. `width`/`height` are optional so a plan can move cards
 * without resizing them; omitted geometry is never written.
 */
export interface LayoutPlanPlacement {
  readonly boardId: string;
  readonly cardId: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/** One section geometry write; the section keeps its board, title and color. */
export interface LayoutPlanSection {
  readonly sectionId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutPlan {
  /** Every board the plan intends to touch; unknown ids are rejected. */
  readonly boards: readonly string[];
  readonly placements: readonly LayoutPlanPlacement[];
  readonly sections?: readonly LayoutPlanSection[] | undefined;
  /** Portal frame sizes keyed by card id, for portals scaled to their target. */
  readonly portalSizes?: Readonly<Record<string, LayoutPlanSize>> | undefined;
}

export interface LayoutPlanSummary {
  /** Placements whose coordinates or size actually changed. */
  readonly placements: number;
  readonly sections: number;
  readonly boards: number;
}

export interface ApplyLayoutPlanOptions {
  /** Commit origin; defaults to `layout:apply`. */
  readonly origin?: string | undefined;
}

/**
 * What a plan is validated against. `WorkspaceDocument.applyLayoutPlan` backs
 * this with the document maps, so the checks stay pure and testable.
 */
export interface LayoutPlanTargets {
  hasBoard(id: string): boolean;
  hasCard(id: string): boolean;
  hasSection(id: string): boolean;
  /** Boards where the card already sits; a portal size needs a placement. */
  placedBoards(cardId: string): readonly string[];
}

export class LayoutPlanError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Layout plan rejected: ${issues.join("; ")}`);
    this.name = "LayoutPlanError";
    this.issues = [...issues];
  }
}

export const layoutPlanPlacementSchema = z.object({
  boardId: entityIdSchema,
  cardId: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
});

export const layoutPlanSectionSchema = z.object({
  sectionId: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const layoutPlanSizeSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const layoutPlanSchema = z.object({
  boards: z.array(entityIdSchema),
  placements: z.array(layoutPlanPlacementSchema),
  sections: z.array(layoutPlanSectionSchema).optional(),
  portalSizes: z.record(entityIdSchema, layoutPlanSizeSchema).optional(),
});

/** Parses a plan, turning schema failures into a `LayoutPlanError`. */
export function parseLayoutPlan(value: unknown): LayoutPlan {
  const result = layoutPlanSchema.safeParse(value);
  if (result.success) return result.data;
  throw new LayoutPlanError(
    result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  );
}

/** Keeps a finite coordinate inside the range a publish would accept. */
export function clampLayoutCoordinate(value: number): number {
  return Math.min(MAX_LAYOUT_COORDINATE, Math.max(-MAX_LAYOUT_COORDINATE, value));
}

/**
 * Every reason a plan cannot be applied. Schema-level problems (non-finite
 * coordinates, non-positive sizes) are rejected earlier by `parseLayoutPlan`;
 * these are the referential checks that need the workspace.
 */
export function layoutPlanIssues(plan: LayoutPlan, targets: LayoutPlanTargets): string[] {
  const issues: string[] = [];
  const boards = new Set<string>(plan.boards);
  for (const placement of plan.placements) boards.add(placement.boardId);
  for (const boardId of boards) {
    if (!targets.hasBoard(boardId)) issues.push(`Unknown board: ${boardId}`);
  }

  const placed = new Set<string>();
  for (const placement of plan.placements) {
    const key = `${placement.boardId}\u001f${placement.cardId}`;
    if (placed.has(key)) {
      issues.push(`Duplicate placement for card ${placement.cardId} on board ${placement.boardId}`);
    }
    placed.add(key);
    if (!targets.hasCard(placement.cardId)) {
      issues.push(`Unknown card: ${placement.cardId}`);
    }
  }

  const sections = new Set<string>();
  for (const section of plan.sections ?? []) {
    if (sections.has(section.sectionId)) {
      issues.push(`Duplicate section: ${section.sectionId}`);
    }
    sections.add(section.sectionId);
    if (!targets.hasSection(section.sectionId)) {
      issues.push(`Unknown section: ${section.sectionId}`);
    }
  }

  for (const cardId of Object.keys(plan.portalSizes ?? {})) {
    if (!targets.hasCard(cardId)) {
      issues.push(`Unknown card: ${cardId}`);
      continue;
    }
    const inPlan = plan.placements.some((placement) => placement.cardId === cardId);
    if (!inPlan && targets.placedBoards(cardId).length === 0) {
      issues.push(`Portal size target ${cardId} has no placement`);
    }
  }

  return issues;
}
