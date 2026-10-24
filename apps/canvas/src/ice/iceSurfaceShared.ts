/**
 * The seams more than one of the surface's modules needs.
 *
 * Nothing here reads or writes the document: the helpers are a widget's box,
 * the Board tree's fold, and the two adapters every failure is reported
 * through. Keeping them here is what lets the seeds, the camera and the hooks
 * share one meaning of "where is this entity" without importing each other.
 */

import type { Board } from "@suite/graph";
import type { CanvasEngine, Entity } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";

/** A rect in world (or board) units. */
export interface IceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

export function quietly(run: () => void): void {
  try {
    run();
  } catch {
    // Teardown is best-effort: a failing close must not mask the surface's state.
    return;
  }
}

/** A Board's frame origins, outermost first — the fold `anchorWorld` undoes. */
export function boardFrames(boards: readonly Board[], boardId: string): IceRect[] {
  const path: IceRect[] = [];
  let current = boards.find((board) => board.id === boardId);
  while (current !== undefined) {
    path.unshift(current.rect);
    const parent = current.parentBoardId;
    current = parent === undefined ? undefined : boards.find((board) => board.id === parent);
  }
  return path;
}

/**
 * The committed rect is the widget's own `Position`/`Size`, never the paper's
 * drawn extents: `half` is "as drawn", so it carries the hold's lift and would
 * commit a shifted card.
 *
 * A projected slot can outlive its entity for one tick (a replace, a teardown,
 * a peer's delete); reading a missing component throws, so the box is asked for
 * only when the entity still carries one.
 */
export function entityRectOf(
  engine: CanvasEngine,
  core: typeof import("@vibecook/ice"),
  entity: Entity,
): IceRect | null {
  const world = engine.world;
  if (!world.has(entity, core.Position)) return null;
  if (!world.has(entity, core.Size)) return null;
  const position = world.read(entity, core.Position);
  const size = world.read(entity, core.Size);
  if (position === undefined || size === undefined) return null;
  const values = [position.x, position.y, size.w, size.h];
  if (!values.every((value) => Number.isFinite(value))) return null;
  return { x: position.x, y: position.y, width: size.w, height: size.h };
}

/** A pointer event's point, in the surface's own CSS pixels. */
export function screenPointOf(
  root: HTMLElement,
  event: { readonly clientX: number; readonly clientY: number },
): { x: number; y: number } {
  const bounds = root.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

/** The entity under a container-relative screen point, or `null`. */
export function entityAt(
  desk: DeskLayerHandle,
  screen: { readonly x: number; readonly y: number },
): Entity | null {
  try {
    return desk.pick(screen)?.entity ?? null;
  } catch {
    return null;
  }
}
