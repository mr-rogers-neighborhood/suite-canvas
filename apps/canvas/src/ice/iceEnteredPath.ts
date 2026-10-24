/**
 * Which Boards the desk is inside, and how to stand in that place again.
 *
 * A Board is a doorway (ADR-0039): entering one pushes ICE's nav stack and
 * reframes the camera in the Board's own units. The document keeps the entered
 * path beside the View's camera, so the path has to be readable from the one
 * place that knows it — ICE's nav stack — and restorable into a fresh engine
 * before the first paint.
 *
 * This module is the only translator between ICE's current frame and the board
 * ids the document stores. It reads the Board mats the seed registered, so a
 * frame this seat never spawned (or a Board a peer deleted) is not a path.
 */

import type { WorkspaceDocument } from "@suite/graph";
import { type CanvasEngine, currentNavFrame, type Entity, type World } from "@vibecook/ice";

import type { FlightCamera } from "./iceCameraFlight";
import { restorableCamera } from "./iceSurfaceCamera";
import type { BoardMat } from "./iceSurfaceSpawns";

/** One Board on the way down, in the order the breadcrumb shows it. */
export interface EnteredFrame {
  readonly id: string;
  readonly name: string;
}

/** Where a View was left: the camera it held, in the frame it held it in. */
export interface ViewStanding {
  readonly camera: FlightCamera;
  readonly path: readonly string[];
  /** The plane pose behind the entered Board, when one was recorded. */
  readonly returnCamera: FlightCamera | null;
}

/**
 * The standing a mount should restore, or `null` when it should fit: a View
 * that never moved, a camera the desk cannot stand in (non-finite, non-positive
 * zoom, outside ICE's limits) and a missing View all answer `null`. The path is
 * only meaningful with the camera that was read in that frame, which is why
 * they are returned together.
 */
export function storedViewStanding(
  workspace: Pick<WorkspaceDocument, "getView" | "hasStoredCamera">,
  viewId: string | null,
): ViewStanding | null {
  if (viewId === null || !workspace.hasStoredCamera(viewId)) return null;
  const view = workspace.getView(viewId);
  if (view === undefined) return null;
  const camera = restorableCamera(view.camera);
  if (camera === null) return null;
  return {
    camera,
    path: view.path ?? [],
    returnCamera: view.returnCamera === undefined ? null : restorableCamera(view.returnCamera),
  };
}

/** Every Board the current seed drew, by id, with the mat entity that opens it. */
export function matsById(
  boards: ReadonlyMap<Entity, BoardMat>,
): Map<string, { entity: Entity; mat: BoardMat }> {
  const byId = new Map<string, { entity: Entity; mat: BoardMat }>();
  for (const [entity, mat] of boards) {
    // A Board is drawn once per seed; a duplicate id keeps the first mat, the
    // one the projection actually planted on the View's plane.
    if (!byId.has(mat.boardId)) byId.set(mat.boardId, { entity, mat });
  }
  return byId;
}

/**
 * The entered path, outermost first, read from ICE's nav stack. Empty on the
 * View's plane, and `null` when the current frame is not reachable from this
 * seed's root — a frame left over from another View. A caller that writes must
 * treat `null` as "this sample says nothing": the camera it read belongs to a
 * frame the View does not own.
 */
export function enteredPathOf(
  world: World,
  boards: ReadonlyMap<Entity, BoardMat>,
  rootBoardId: string,
): EnteredFrame[] | null {
  const frame: Entity | undefined = currentNavFrame(world);
  if (frame === undefined) return [];
  const deepest = boards.get(frame);
  if (deepest === undefined) return null;
  if (deepest.boardId === rootBoardId) return [];
  const byId = matsById(boards);
  const path: EnteredFrame[] = [];
  // The root is the View, not a mat, so the walk ends on the id, not on a miss.
  let boardId: string | undefined = deepest.boardId;
  while (boardId !== undefined && boardId !== rootBoardId && path.length < 32) {
    const mat: BoardMat | undefined = byId.get(boardId)?.mat;
    if (mat === undefined) return [];
    path.unshift({ id: mat.boardId, name: mat.title });
    boardId = mat.parentBoardId;
  }
  // A chain that does not reach the root names a frame this View does not own.
  if (boardId !== rootBoardId) return null;
  return path;
}

/**
 * Enters `path` into a fresh engine, outermost first, snapping rather than
 * flying: a restore is not a journey, and a flight would land after the camera
 * was written. Returns false as soon as a level cannot be entered, so the
 * caller knows the deepest frame is not the one the stored camera belongs to.
 */
export function restoreEnteredPath(
  engine: CanvasEngine,
  boards: ReadonlyMap<Entity, BoardMat>,
  path: readonly string[],
): boolean {
  if (path.length === 0) return true;
  const byId = matsById(boards);
  for (const boardId of path) {
    const entry = byId.get(boardId);
    if (entry === undefined) return false;
    try {
      engine.ops.enterContainer(entry.entity, { transition: "none" });
    } catch {
      return false;
    }
  }
  return true;
}
