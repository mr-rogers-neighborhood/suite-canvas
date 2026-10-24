/**
 * Rebuilding the desk's contents from the document, without losing the seat.
 *
 * The projection reconciles cards and links one change at a time. A *Board* is
 * not like that: it is a container, ICE compiles an inside frame for it at
 * spawn, and its mat is the doorway a reader enters through. So when the Board
 * tree changes — a create, a delete, a rename, a nest, a moved or resized rect —
 * the desk replaces its contents from the document instead of patching them.
 *
 * What a rebuild must not cost the reader:
 *
 * - **the frame they are standing in.** The mat that names it is about to be
 *   deleted, so the nav stack is popped first (a stack pointing at a dead
 *   container is repaired by ICE, not by us) and pushed again afterwards. A
 *   Board that no longer exists cannot be entered; the reader lands in the
 *   deepest ancestor that survived.
 * - **the camera.** A camera is only meaningful in the frame it was read in, so
 *   it is read before the pop and written back only when the path came back
 *   unchanged. A shortened path is a different place: its own arrival framing is
 *   the honest camera there.
 *
 * The selection is not handled here: it lives in the shell (Zustand) as card
 * ids, and the projection re-derives the entities once the new seed is
 * registered.
 *
 * Everything the function needs is a seam — the engine, the tree, the mats on
 * screen and a `replace` that swaps the contents — so "one rebuild, one exit,
 * one re-entry" is a unit test rather than a browser observation.
 */

import type { Board } from "@suite/graph";
import type { CanvasEngine, Entity } from "@vibecook/ice";

import { survivingEnteredPath } from "./iceBoardTree";
import type { FlightCamera } from "./iceCameraFlight";
import { enteredPathOf, restoreEnteredPath } from "./iceEnteredPath";
import { worldOf } from "./iceSurfaceCamera";
import { quietly } from "./iceSurfaceShared";
import type { BoardMat, SeedReport } from "./iceSurfaceSpawns";

export interface BoardReseedInput {
  readonly engine: CanvasEngine;
  /** The tree *after* the change: a deleted Board is not in it. */
  readonly boards: readonly Board[];
  readonly rootBoardId: string;
  /** The mats on the desk now — the entered path is read against these first. */
  readonly mats: ReadonlyMap<Entity, BoardMat>;
  /** Swap the desk's contents for the document's; the seed now on the desk. */
  readonly replace: () => SeedReport | null;
  readonly readCamera: () => FlightCamera | null;
  readonly writeCamera: (camera: FlightCamera) => void;
}

export interface BoardReseedReport {
  /** The path the desk stands in afterwards, surviving Boards only. */
  readonly path: readonly string[];
  /** Levels the reader lost because their Boards were deleted. */
  readonly exited: number;
  /** True when the camera was written back into the frame it was read in. */
  readonly cameraRestored: boolean;
  /** The seed now on the desk; `null` when the rebuild did not happen. */
  readonly seed: SeedReport | null;
}

/**
 * Rebuild the desk from the document in the engine it already lives on.
 *
 * The order matters and is the whole contract: read the standing, leave the
 * frame, replace, re-enter, restore the camera.
 */
export function reseedBoardTree(input: BoardReseedInput): BoardReseedReport {
  const { engine, boards, rootBoardId, mats, replace, readCamera, writeCamera } = input;
  const world = worldOf(engine);
  // `[]` is the View's plane and `null` is "this frame is not one this seed
  // built" (a leftover from another View); neither has a Board to come back to,
  // so both are flattened to the plane here.
  const standing =
    world === undefined
      ? []
      : (enteredPathOf(world, mats, rootBoardId) ?? []).map((frame) => frame.id);
  const camera = readCamera();
  if (engine.nav.depth() > 0) quietly(() => engine.ops.exitTo(0, { transition: "none" }));

  const seed = replace();
  if (seed === null) {
    return { path: [], exited: standing.length, cameraRestored: false, seed: null };
  }

  const path = survivingEnteredPath(boards, standing);
  const restored = restoreEnteredPath(engine, seed.boardMats, path);
  const cameraRestored = restored && camera !== null && path.length === standing.length;
  if (cameraRestored) quietly(() => writeCamera(camera));
  return { path, exited: standing.length - path.length, cameraRestored, seed };
}
