/**
 * LayoutPlan generation via ephemeral spatial propagator networks.
 *
 * Resolves card collision, displacement waves, and container breathing in an
 * ephemeral, localized subnet (< 0.1ms) and emits a pure LayoutPlan for single-batch
 * Loro commitment.
 */

import type { LayoutPlan, LayoutPlanPlacement, LayoutPlanSection } from "../layoutPlan.js";
import type { Placement, Section } from "../schema.js";
import { type Propagator, settle } from "./engine.js";
import { createInterval, intervalExact } from "./interval.js";
import { pinConstraint, separationConstraint } from "./spatialPropagators.js";

export const DEFAULT_REFLOW_CARD_WIDTH = 288;
export const DEFAULT_REFLOW_CARD_HEIGHT = 160;
export const DEFAULT_REFLOW_GAP = 24;
export const DEFAULT_REFLOW_SECTION_PADDING = 24;

export interface ReflowInput {
  readonly boardId: string;
  readonly targetCardId: string;
  readonly targetPosition: { readonly x: number; readonly y: number };
  readonly targetSize: { readonly width: number; readonly height: number };
  readonly placements: readonly Placement[];
  readonly axis?: "x" | "y" | "auto" | undefined;
  readonly gap?: number | undefined;
  readonly sections?: readonly Section[] | undefined;
  readonly sectionPadding?: number | undefined;
}

interface Box {
  cardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOf(placement: Placement): Box {
  return {
    cardId: placement.cardId,
    x: placement.x,
    y: placement.y,
    width: placement.width ?? DEFAULT_REFLOW_CARD_WIDTH,
    height: placement.height ?? DEFAULT_REFLOW_CARD_HEIGHT,
  };
}

function overlapsSpan(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
  return Math.max(aLo, bLo) < Math.min(aHi, bHi);
}

/**
 * Calculates a non-destructive layout reflow proposal when a card is moved or expanded.
 *
 * Returns null if no collision occurs and no cards need displacement.
 */
export function proposeReflowPlan(input: ReflowInput): LayoutPlan | null {
  const {
    boardId,
    targetCardId,
    targetPosition,
    targetSize,
    placements,
    axis = "auto",
    gap = DEFAULT_REFLOW_GAP,
    sections = [],
    sectionPadding = DEFAULT_REFLOW_SECTION_PADDING,
  } = input;

  const boardPlacements = placements.filter(
    (p) => p.boardId === boardId && p.cardId !== targetCardId,
  );
  if (boardPlacements.length === 0) return null;

  const targetBox: Box = {
    cardId: targetCardId,
    x: targetPosition.x,
    y: targetPosition.y,
    width: targetSize.width,
    height: targetSize.height,
  };

  const otherBoxes = boardPlacements.map(boxOf);

  // Build the collision dependency graph (ephemeral footprint)
  const cluster = new Map<string, Box>();
  cluster.set(targetCardId, targetBox);

  // Queue-based BFS to collect cascading collision neighbors in 2D
  const queue: Box[] = [targetBox];
  interface SeparationPair {
    predecessor: Box;
    successor: Box;
    axis: "x" | "y";
    direction: "+" | "-";
    dimension: number;
  }
  const separationPairs: SeparationPair[] = [];
  const cardMoveDirections = new Map<string, { axis: "x" | "y"; direction: "+" | "-" }>();
  const effectiveCoords = new Map<string, { x: number; y: number }>();
  effectiveCoords.set(targetCardId, { x: targetPosition.x, y: targetPosition.y });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const currentCoord = effectiveCoords.get(current.cardId) ?? { x: current.x, y: current.y };
    const currentBox: Box = {
      cardId: current.cardId,
      x: currentCoord.x,
      y: currentCoord.y,
      width: current.width,
      height: current.height,
    };

    const currentCenterX = currentBox.x + currentBox.width / 2;
    const currentCenterY = currentBox.y + currentBox.height / 2;

    const candidates: Array<{
      box: Box;
      axis: "x" | "y";
      direction: "+" | "-";
      overlapX: number;
      overlapY: number;
    }> = [];

    for (const other of otherBoxes) {
      if (cluster.has(other.cardId)) continue;

      const otherCenterX = other.x + other.width / 2;
      const otherCenterY = other.y + other.height / 2;

      const dx = otherCenterX - currentCenterX;
      const dy = otherCenterY - currentCenterY;

      const overlapX = (currentBox.width + other.width) / 2 + gap - Math.abs(dx);
      const overlapY = (currentBox.height + other.height) / 2 + gap - Math.abs(dy);

      // Only colliding boxes
      if (overlapX <= 0 || overlapY <= 0) continue;

      let pairAxis: "x" | "y";
      if (axis === "x") pairAxis = "x";
      else if (axis === "y") pairAxis = "y";
      else {
        // Minimum Translation Vector (MTV) for least displacement
        pairAxis = overlapX < overlapY ? "x" : "y";
      }

      let pairDirection: "+" | "-";
      if (pairAxis === "x") {
        pairDirection = dx >= 0 ? "+" : "-";
      } else {
        pairDirection = dy >= 0 ? "+" : "-";
      }

      candidates.push({
        box: other,
        axis: pairAxis,
        direction: pairDirection,
        overlapX,
        overlapY,
      });
    }

    // Filter out candidates shielded by another closer candidate in the same direction
    const directColliders = candidates.filter((cand) => {
      return !candidates.some((other) => {
        if (other.box.cardId === cand.box.cardId) return false;
        if (other.axis !== cand.axis || other.direction !== cand.direction) return false;

        if (cand.axis === "x") {
          const crossOverlap = overlapsSpan(
            cand.box.y,
            cand.box.y + cand.box.height,
            other.box.y,
            other.box.y + other.box.height,
          );
          if (!crossOverlap) return false;
          return cand.direction === "+" ? other.box.x < cand.box.x : other.box.x > cand.box.x;
        }

        const crossOverlap = overlapsSpan(
          cand.box.x,
          cand.box.x + cand.box.width,
          other.box.x,
          other.box.x + other.box.width,
        );
        if (!crossOverlap) return false;
        return cand.direction === "+" ? other.box.y < cand.box.y : other.box.y > cand.box.y;
      });
    });

    for (const collider of directColliders) {
      cluster.set(collider.box.cardId, collider.box);
      cardMoveDirections.set(collider.box.cardId, {
        axis: collider.axis,
        direction: collider.direction,
      });

      const dimension =
        collider.direction === "+"
          ? collider.axis === "y"
            ? currentBox.height
            : currentBox.width
          : collider.axis === "y"
            ? collider.box.height
            : collider.box.width;

      separationPairs.push({
        predecessor: currentBox,
        successor: collider.box,
        axis: collider.axis,
        direction: collider.direction,
        dimension,
      });

      // Update projected effective position for downstream queue cascade
      let projectedX = collider.box.x;
      let projectedY = collider.box.y;
      if (collider.axis === "x") {
        projectedX =
          collider.direction === "+"
            ? Math.max(collider.box.x, currentBox.x + currentBox.width + gap)
            : Math.min(collider.box.x, currentBox.x - collider.box.width - gap);
      } else {
        projectedY =
          collider.direction === "+"
            ? Math.max(collider.box.y, currentBox.y + currentBox.height + gap)
            : Math.min(collider.box.y, currentBox.y - collider.box.height - gap);
      }
      effectiveCoords.set(collider.box.cardId, { x: projectedX, y: projectedY });
      queue.push(collider.box);
    }
  }

  // If no neighbors collided, no reflow needed
  if (separationPairs.length === 0) {
    return null;
  }

  // Build ephemeral tissue and propagators
  const tissue = new Map<string, ReturnType<typeof createInterval>>();
  const propagators: Propagator[] = [];

  // Initialize intervals for cards in the cluster
  for (const box of cluster.values()) {
    const cellX = `${box.cardId}_x`;
    const cellY = `${box.cardId}_y`;

    if (box.cardId === targetCardId) {
      // Target card is pinned to its desired drop/resize position
      tissue.set(cellX, intervalExact(box.x));
      tissue.set(cellY, intervalExact(box.y));
      propagators.push(pinConstraint(cellX, box.x));
      propagators.push(pinConstraint(cellY, box.y));
    } else {
      const moveInfo = cardMoveDirections.get(box.cardId);
      if (!moveInfo) continue;

      if (moveInfo.axis === "x") {
        if (moveInfo.direction === "+") {
          tissue.set(cellX, createInterval(box.x, Number.POSITIVE_INFINITY));
        } else {
          tissue.set(cellX, createInterval(Number.NEGATIVE_INFINITY, box.x));
        }
        // Cross axis is pinned to guarantee zero drift
        tissue.set(cellY, intervalExact(box.y));
        propagators.push(pinConstraint(cellY, box.y));
      } else {
        if (moveInfo.direction === "+") {
          tissue.set(cellY, createInterval(box.y, Number.POSITIVE_INFINITY));
        } else {
          tissue.set(cellY, createInterval(Number.NEGATIVE_INFINITY, box.y));
        }
        // Cross axis is pinned to guarantee zero drift
        tissue.set(cellX, intervalExact(box.x));
        propagators.push(pinConstraint(cellX, box.x));
      }
    }
  }

  // Attach monotonic separation propagators
  for (const pair of separationPairs) {
    const predCell = `${pair.predecessor.cardId}_${pair.axis}`;
    const succCell = `${pair.successor.cardId}_${pair.axis}`;
    propagators.push(separationConstraint(predCell, succCell, pair.direction, pair.dimension, gap));
  }

  // Settle the ephemeral tissue to fixed point
  const result = settle(tissue, propagators);
  if (result.type !== "success") {
    // If inconsistent or step limit reached, gracefully decline reflow
    return null;
  }

  // Collect placement writes for cards that actually shifted
  const placementsToWrite: LayoutPlanPlacement[] = [];
  const updatedBoxes: Box[] = [];

  for (const box of cluster.values()) {
    if (box.cardId === targetCardId) {
      placementsToWrite.push({
        boardId,
        cardId: box.cardId,
        x: targetPosition.x,
        y: targetPosition.y,
        width: targetSize.width,
        height: targetSize.height,
      });
      updatedBoxes.push(targetBox);
      continue;
    }

    const moveInfo = cardMoveDirections.get(box.cardId);
    if (!moveInfo) continue;

    const cell = `${box.cardId}_${moveInfo.axis}`;
    const settledInterval = result.tissue.get(cell);
    if (!settledInterval) continue;

    const rawCoord = moveInfo.direction === "+" ? settledInterval.lo : settledInterval.hi;
    if (!Number.isFinite(rawCoord)) continue;

    const newCoord = rawCoord;
    const oldCoord = moveInfo.axis === "x" ? box.x : box.y;

    if (Math.abs(newCoord - oldCoord) > 0.5) {
      const newX = moveInfo.axis === "x" ? newCoord : box.x;
      const newY = moveInfo.axis === "y" ? newCoord : box.y;
      if (!Number.isFinite(newX) || !Number.isFinite(newY)) continue;
      placementsToWrite.push({
        boardId,
        cardId: box.cardId,
        x: newX,
        y: newY,
        width: box.width,
        height: box.height,
      });
      updatedBoxes.push({ ...box, x: newX, y: newY });
    }
  }

  if (placementsToWrite.length <= 1) {
    // Only target card was placed, no neighbors moved
    return null;
  }

  // 4-Way Section Expansion (Breathing in Left, Up, Right, and Down directions)
  const boardSections = sections.filter((s) => s.boardId === boardId);
  const sectionsToWrite: LayoutPlanSection[] = [];

  for (const section of boardSections) {
    // Find all cards associated with this section:
    // Either cards that were inside the section initially, or updated boxes that overlap the section
    const memberBoxes = otherBoxes.filter((b) => {
      const wasInside =
        b.x >= section.x - sectionPadding &&
        b.x + b.width <= section.x + section.width + sectionPadding &&
        b.y >= section.y - sectionPadding &&
        b.y + b.height <= section.y + section.height + sectionPadding;
      return wasInside;
    });

    const relevantBoxes = [
      ...memberBoxes.map((mb) => {
        const updated = updatedBoxes.find((ub) => ub.cardId === mb.cardId);
        return updated ?? mb;
      }),
      // Include targetBox if target is placed into or touches this section
      ...(targetBox.x + targetBox.width >= section.x &&
      targetBox.x <= section.x + section.width &&
      targetBox.y + targetBox.height >= section.y &&
      targetBox.y <= section.y + section.height
        ? [targetBox]
        : []),
    ];

    if (relevantBoxes.length === 0) continue;

    const minLeft = Math.min(...relevantBoxes.map((b) => b.x));
    const minTop = Math.min(...relevantBoxes.map((b) => b.y));
    const maxRight = Math.max(...relevantBoxes.map((b) => b.x + b.width));
    const maxBottom = Math.max(...relevantBoxes.map((b) => b.y + b.height));

    if (
      !Number.isFinite(minLeft) ||
      !Number.isFinite(minTop) ||
      !Number.isFinite(maxRight) ||
      !Number.isFinite(maxBottom)
    ) {
      continue;
    }

    const newX = Math.min(section.x, minLeft - sectionPadding);
    const newY = Math.min(section.y, minTop - sectionPadding);
    const newRight = Math.max(section.x + section.width, maxRight + sectionPadding);
    const newBottom = Math.max(section.y + section.height, maxBottom + sectionPadding);
    const newWidth = newRight - newX;
    const newHeight = newBottom - newY;

    if (
      !Number.isFinite(newX) ||
      !Number.isFinite(newY) ||
      !Number.isFinite(newWidth) ||
      !Number.isFinite(newHeight)
    ) {
      continue;
    }

    if (
      Math.abs(newX - section.x) > 0.5 ||
      Math.abs(newY - section.y) > 0.5 ||
      Math.abs(newWidth - section.width) > 0.5 ||
      Math.abs(newHeight - section.height) > 0.5
    ) {
      sectionsToWrite.push({
        sectionId: section.id,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      });
    }
  }

  return {
    boards: [boardId],
    placements: placementsToWrite,
    ...(sectionsToWrite.length > 0 ? { sections: sectionsToWrite } : {}),
  };
}
