import { proposeReflowPlan, type WorkspaceDocument } from "@suite/graph";

export interface CardResizeGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Commits a card resize gesture atomically to the workspace document.
 *
 * If the expanded card overlaps neighboring cards, a multi-dimensional reflow
 * plan is computed via ephemeral spatial propagators. The resized card, displaced
 * neighbors, and any containing sections are committed in a single Loro batch
 * with a single undo step.
 */
export function commitCardResize(
  workspace: WorkspaceDocument,
  boardId: string,
  cardId: string,
  geometry: CardResizeGeometry,
  cardSizes?: ReadonlyMap<string, { readonly width: number; readonly height: number }>,
): void {
  const plan = proposeReflowPlan({
    boardId,
    targetCardId: cardId,
    targetPosition: { x: geometry.x, y: geometry.y },
    targetSize: { width: geometry.width, height: geometry.height },
    placements: workspace.listPlacements(),
    sections: workspace.listSections(boardId),
    cardSizes,
  });

  if (plan) {
    workspace.applyLayoutPlan(plan);
  } else {
    workspace.updatePlacementGeometry(boardId, cardId, geometry);
  }
}
