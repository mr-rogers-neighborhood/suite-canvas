/**
 * The wiring contract for the desk's lifecycle.
 *
 * The surface's interaction used to be one `useEffect`: the projection, the
 * link gesture, presence, the board gestures and the whiteboard's suspension
 * all started and stopped together, on one dependency list. Each of those now
 * lives in its own hook, and every one of them takes this object as its trigger
 * — so they still start and stop together, exactly when the single effect did.
 *
 * `resolveSurface` is the same guard the single effect applied before it
 * attached anything: the root, the desk handle and the overlay host must all
 * exist, or the surface is not mounted yet and there is nothing to wire.
 */

import type { WorkspaceDocument } from "@suite/graph";
import type { CanvasEngine, DocSession, EngineGpu } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { type RefObject, useMemo } from "react";

import type { FlightCamera } from "./iceCameraFlight";
import type { IceShareCaps } from "./iceShareCaps";
import type { IceCameraApi } from "./iceSurfaceCamera";
import type { EdgeSpawns, SeedReport } from "./iceSurfaceSpawns";
import type { Phase } from "./iceSurfaceStatus";

/** The commands the keymap and the zoom cluster call; filled by the board gesture. */
export interface IceCommands {
  undo(): void;
  redo(): void;
  /** Delete/Backspace: remove the selection from the Board it is on. */
  deleteSelection(): void;
  /** Shift+Delete: move the selection to the trash (the only destructive key). */
  trashSelection?(): void;
  /**
   * Cmd/Ctrl+C: remember the selection's ids and positions. No write; a seat
   * that cannot create cards remembers nothing.
   */
  copy(): void;
  /** Cmd/Ctrl+X: copy, then remove the selection from its Board (recoverable). */
  cut(): void;
  /** Cmd/Ctrl+V: clone the buffer onto the Board under the pointer, in one commit. */
  paste(): void;
  /** Cmd/Ctrl+D: clone each selected card down-right of itself, in one commit. */
  duplicate(): void;
  /** Arrow keys: nudge the selection by one unit (ten with Shift), one write. */
  nudge(dx: number, dy: number): void;
  reconcile(): void;
  escape(): void;
  zoomBy(factor: number): void;
  fitView(): void;
}

/** What the boot owns: the engine, its document, the shared device and the links. */
export interface IceOwned {
  engine?: CanvasEngine;
  doc?: DocSession;
  gpu?: EngineGpu;
  clearCardRenderer?: (() => void) | undefined;
  edges?: EdgeSpawns | undefined;
  /**
   * The structural key of the Board tree the contents were seeded from
   * (`iceBoardTree.ts`). The projection compares the document against it and
   * asks for a rebuild when a Board was added, deleted, renamed, nested or
   * moved — the one class of change the cheap reconcile cannot absorb.
   */
  structure?: string | null | undefined;
  /** Rebuild the desk's contents from the document, keeping the reader's seat. */
  reseed?: (() => void) | undefined;
}

export interface IceWiring {
  readonly phase: Phase;
  readonly seed: SeedReport | null;
  readonly layerReady: number;
  readonly workspaceMode: boolean;
  readonly liveWorkspace: WorkspaceDocument | null;
  readonly rootBoardId: string | null;
  readonly caps: IceShareCaps;
  readonly cameraApi: IceCameraApi | null;
  readonly flyTo: (target: FlightCamera | null) => void;
}

/** The DOM the surface's hooks attach to. Set on the first mount, stable after. */
export interface IceSurfaceRefs {
  readonly surface: RefObject<HTMLElement | null>;
  readonly desk: RefObject<DeskLayerHandle | null>;
  readonly overlays: RefObject<HTMLDivElement | null>;
}

export interface IceSurfaceDom {
  readonly root: HTMLElement;
  readonly desk: DeskLayerHandle;
  readonly overlays: HTMLDivElement;
}

/** The surface's DOM, or `null` while the desk is still booting. */
export function resolveSurface(refs: IceSurfaceRefs): IceSurfaceDom | null {
  const root = refs.surface.current;
  const desk = refs.desk.current;
  const overlays = refs.overlays.current;
  if (root === null || desk === null || overlays === null) return null;
  return { root, desk, overlays };
}

/** One identity per wiring run: every hook's effect re-runs when this changes. */
export function useIceWiring(input: IceWiring): IceWiring {
  const { phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId, caps } = input;
  const { cameraApi, flyTo } = input;
  return useMemo(
    () => ({
      phase,
      seed,
      layerReady,
      workspaceMode,
      liveWorkspace,
      rootBoardId,
      caps,
      cameraApi,
      flyTo,
    }),
    [phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId, caps, cameraApi, flyTo],
  );
}
