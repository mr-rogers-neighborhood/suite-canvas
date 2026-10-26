import type { PlacementSnapshot } from "../../merge.js";
import { edgeKinds, edgePaths, type GraphEdge, type Section, sectionColors } from "../../schema.js";

import { DEFAULT_PUBLISH_LIMITS, type PublishLimits, utf8ByteLength } from "./limits.js";

/**
 * Owns the issues a plan records instead of throwing: what is wrong with a placement, a
 * section or an edge as a sentence a share can show.
 */

function withinBounds(value: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;
}

/** Why a draft placement cannot be published, or `null`. */
export function placementIssue(
  placement: PlacementSnapshot,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
): string | null {
  const max = limits.maxCoordinate;
  if (!withinBounds(placement.x, max) || !withinBounds(placement.y, max)) {
    return `Card ${placement.cardId} is placed outside ±${max}`;
  }
  if (!withinBounds(placement.z, max)) {
    return `Card ${placement.cardId} has a stacking order outside ±${max}`;
  }
  const sizes = [
    ["width", placement.width],
    ["height", placement.height],
  ] as const;
  for (const [name, value] of sizes) {
    if (value === undefined) continue;
    if (!withinBounds(value, max) || value <= 0) {
      return `Card ${placement.cardId} has an invalid ${name}`;
    }
  }
  return null;
}

/** Why a draft section cannot be published, or `null`. */
export function sectionIssue(
  section: Section,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
): string | null {
  if (utf8ByteLength(section.title) > limits.maxSectionTitleLength) {
    return `Section ${section.id} has a title longer than ${limits.maxSectionTitleLength} bytes`;
  }
  if (section.color !== undefined && !sectionColors.includes(section.color)) {
    return `Section ${section.id} has an unknown color`;
  }
  const max = limits.maxCoordinate;
  if (!withinBounds(section.x, max) || !withinBounds(section.y, max)) {
    return `Section ${section.id} is placed outside ±${max}`;
  }
  if (!withinBounds(section.z, max)) {
    return `Section ${section.id} has a stacking order outside ±${max}`;
  }
  if (!withinBounds(section.width, max) || section.width <= 0) {
    return `Section ${section.id} has an invalid width`;
  }
  if (!withinBounds(section.height, max) || section.height <= 0) {
    return `Section ${section.id} has an invalid height`;
  }
  return null;
}

export interface EdgeValidationContext {
  /** Whether a card an edge points at still exists in the publish target. */
  isCardLive?: ((cardId: string) => boolean) | undefined;
}

/** Why a draft edge cannot be published, or `null`. */
export function edgeIssue(
  edge: GraphEdge,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
  context: EdgeValidationContext = {},
): string | null {
  if (edge.label !== undefined && utf8ByteLength(edge.label) > limits.maxEdgeLabelLength) {
    return `Edge ${edge.id} has a label longer than ${limits.maxEdgeLabelLength} bytes`;
  }
  if (
    edge.labelOffset !== undefined &&
    (!Number.isFinite(edge.labelOffset) || edge.labelOffset < 0 || edge.labelOffset > 1)
  ) {
    return `Edge ${edge.id} has a label offset outside 0..1`;
  }
  if (!edgeKinds.includes(edge.kind)) return `Edge ${edge.id} has an unknown kind`;
  if (!edgePaths.includes(edge.path)) return `Edge ${edge.id} has an unknown path`;
  if (edge.source === edge.target) return `Edge ${edge.id} connects a card to itself`;
  if (context.isCardLive) {
    if (!context.isCardLive(edge.source)) {
      return `Edge ${edge.id} starts at a card that does not exist: "${edge.source}"`;
    }
    if (!context.isCardLive(edge.target)) {
      return `Edge ${edge.id} points at a card that does not exist: "${edge.target}"`;
    }
  }
  return null;
}
