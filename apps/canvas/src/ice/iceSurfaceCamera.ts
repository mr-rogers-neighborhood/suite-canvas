/**
 * The camera, in ICE's own convention, and the flight that moves it.
 *
 * The camera is the world point at the viewport's top-left, so
 * `screen = (world - camera) * zoom` and `world = screen / zoom + camera`. A
 * camera read here can be handed to ICE unchanged — this module is the only
 * place the surface converts between the two, which is what keeps a peer dot on
 * the card it belongs to.
 *
 * Movement is a flight (ADR-0037 §6): `flyTo` plans one, `useIceCameraFrame`
 * advances it, and a zoom step or a middle-drag writes the camera directly
 * because those are the wheel and the hand, not a journey.
 */

import type { CanvasEngine, World } from "@vibecook/ice";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import {
  type FlightCamera,
  type FlightPlan,
  type FlightViewport,
  flightDone,
  planFlight,
  sampleFlight,
} from "./iceCameraFlight";
import { beginMiddlePan, endMiddlePan, type MiddlePanState, updateMiddlePan } from "./iceMiddlePan";
import { publishScreenCamera } from "./iceScreenToWorld";
import type { Phase } from "./iceSurfaceStatus";
import { type IceSurfaceRefs, type IceWiring, resolveSurface } from "./iceSurfaceWiring";

/**
 * The engine's world, when it has one. The surface mounts a stub engine in the
 * jsdom tests and a device that has not booted has no world either, so every
 * camera path degrades to "no camera" instead of throwing.
 */
export function worldOf(engine: CanvasEngine): World | undefined {
  return (engine as { readonly world?: World }).world;
}

/** A world rect: what Fit View frames. */
export interface FitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Screen margin kept around a fitted View, as a fraction of the viewport. */
export const FIT_PADDING = 0.06;
/** A fit is never tighter than this, so an enormous empty View still frames. */
export const FIT_MIN_ZOOM = 0.02;
/** …and never closer than this, so a single small card does not fill the screen. */
export const FIT_MAX_ZOOM = 4;

/**
 * ICE's own CameraLimits (`settings.zoom` on the desk): the band every camera
 * path clamps to. A stored camera outside it cannot be written back — the
 * engine would clamp it to a different framing — so a restore treats it as
 * unusable and the View fits instead.
 */
export const ICE_MIN_ZOOM = 1e-8;
export const ICE_MAX_ZOOM = 1e8;

/** A usable zoom: the fit limits, with a non-positive request ignored. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return FIT_MIN_ZOOM;
  return Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, zoom));
}

/**
 * A camera read back from the document, when the desk can actually stand in it:
 * finite, positively zoomed, and inside ICE's limits. Anything else returns
 * `null`, which is the caller's cue to fit rather than jump somewhere wrong.
 */
export function restorableCamera(camera: {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}): FlightCamera | null {
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return null;
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;
  if (camera.zoom < ICE_MIN_ZOOM || camera.zoom > ICE_MAX_ZOOM) return null;
  return { x: camera.x, y: camera.y, zoom: camera.zoom };
}

/** A stored extent when it is a real one, else the natural size. */
export function extentOf(value: number | undefined, natural: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : natural;
}

/** The camera that centres `bounds` at the zoom that fits it in `viewport`. */
export function fitCamera(bounds: FitRect, viewport: FlightViewport): FlightCamera {
  const width = viewport.width * (1 - FIT_PADDING * 2);
  const height = viewport.height * (1 - FIT_PADDING * 2);
  const fit =
    width > 0 && height > 0
      ? Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height))
      : FIT_MIN_ZOOM;
  const zoom = clampZoom(fit);
  // ICE's camera is the world point at the viewport's top-left:
  // `screen = (world - camera) * zoom`.
  return {
    x: bounds.x + bounds.width / 2 - viewport.width / (2 * zoom),
    y: bounds.y + bounds.height / 2 - viewport.height / (2 * zoom),
    zoom,
  };
}

/**
 * `camera` with its zoom replaced, holding the world point under `anchor`
 * (screen px) still — what a zoom-in/zoom-out control asks for.
 */
export function zoomedCamera(
  camera: FlightCamera,
  zoom: number,
  anchor: { readonly x: number; readonly y: number },
): FlightCamera {
  const next = clampZoom(zoom);
  if (!(camera.zoom > 0) || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
    return { ...camera, zoom: next };
  }
  const worldX = anchor.x / camera.zoom + camera.x;
  const worldY = anchor.y / camera.zoom + camera.y;
  return { x: worldX - anchor.x / next, y: worldY - anchor.y / next, zoom: next };
}

/**
 * A camera flight is a courtesy, not a rule: a reader who asked the system to
 * reduce motion gets the destination without the travel, and the commit rule
 * and the document are unchanged (ADR-0037 §6).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * The one way to read and move the camera, in **ICE's own convention**: the
 * camera is the world point at the viewport's top-left, so
 * `screen = (world - camera) * zoom` and `world = screen / zoom + camera`.
 *
 * This is the surface's only camera convention now. It used to publish a
 * screen-offset camera while the projection and the overlays applied ICE's
 * formula, which put every peer dot and presence ring a zoom-factor away from
 * the card it belonged to. A camera read here can be handed to ICE unchanged.
 */
export interface IceCameraApi {
  cameraOf(): FlightCamera | null;
  viewportOf(): FlightViewport | null;
  write(camera: FlightCamera): void;
}

/** A flight in progress: the plan, and when the frame loop started sampling it. */
export interface FlightState {
  readonly plan: FlightPlan;
  readonly startedAt: number;
}

export interface IceCamera {
  readonly cameraApi: IceCameraApi | null;
  readonly flyTo: (target: FlightCamera | null) => void;
  readonly zoomBy: (factor: number) => void;
  /** The flight in progress, shared with the per-frame pass that advances it. */
  readonly flight: RefObject<FlightState | null>;
}

export function useIceCamera(input: {
  readonly phase: Phase;
  readonly surfaceRef: RefObject<HTMLElement | null>;
}): IceCamera {
  const { phase, surfaceRef } = input;
  const flight = useRef<FlightState | null>(null);

  const cameraApi = useMemo<IceCameraApi | null>(() => {
    if (phase.kind !== "ready") return null;
    const { engine, core } = phase;
    const cameraOf = (): FlightCamera | null => {
      const world = worldOf(engine);
      if (world === undefined) return null;
      const view = world.getResource(core.Camera);
      if (view === undefined) return null;
      const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
      return { x: view.x, y: view.y, zoom };
    };
    const viewportOf = (): FlightViewport | null => {
      const world = worldOf(engine);
      const size = world?.getResource(core.Viewport);
      const root = surfaceRef.current;
      const width = size !== undefined && size.w > 0 ? size.w : (root?.clientWidth ?? 0);
      const height = size !== undefined && size.h > 0 ? size.h : (root?.clientHeight ?? 0);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      return { width, height };
    };
    const write = (camera: FlightCamera): void => {
      const world = worldOf(engine);
      if (world === undefined) return;
      if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
      core.writeRuntimeResource(world, core.Camera, {
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
        gesturing: false,
      });
    };
    return { cameraOf, viewportOf, write };
  }, [phase, surfaceRef]);

  /**
   * Navigation is movement (ADR-0037 §6): every camera change is a flight,
   * planned from the distance and sampled per frame. No `zoomTo`, `panTo` or
   * `zoomToFit` shortcut lives on this path — the only `zoomToFit` left is the
   * initial demo framing.
   */
  const flyTo = useCallback(
    (target: FlightCamera | null): void => {
      if (cameraApi === null || target === null) return;
      if (prefersReducedMotion()) {
        cameraApi.write(target);
        return;
      }
      const from = cameraApi.cameraOf();
      if (from === null) return;
      const plan = planFlight(from, target, cameraApi.viewportOf());
      if (!plan.moving) {
        cameraApi.write(plan.to);
        return;
      }
      flight.current = { plan, startedAt: performance.now() };
    },
    [cameraApi],
  );

  /**
   * One notch of the zoom cluster.
   *
   * This is *not* a flight. A flight is for travelling somewhere (a card, a
   * type); a zoom step is a continuous adjustment, and animating each one made
   * a held button hop and lag behind the pointer. The camera is written at
   * once, so clicks and holds both feel like the wheel they stand in for. The
   * anchor is the viewport centre, so the step keeps whatever is in the middle
   * of the screen in the middle of the screen.
   */
  const zoomBy = useCallback(
    (factor: number): void => {
      const camera = cameraApi?.cameraOf() ?? null;
      const viewport = cameraApi?.viewportOf() ?? null;
      if (camera === null || viewport === null) return;
      if (!Number.isFinite(factor) || factor <= 0) return;
      // A step interrupts a flight: the user is steering, and the flight was
      // taking them elsewhere.
      flight.current = null;
      cameraApi?.write(
        zoomedCamera(camera, camera.zoom * factor, {
          x: viewport.width / 2,
          y: viewport.height / 2,
        }),
      );
    },
    [cameraApi],
  );

  return useMemo(() => ({ cameraApi, flyTo, zoomBy, flight }), [cameraApi, flyTo, zoomBy]);
}

/**
 * One per-frame pass over the *camera*: advance a flight and publish the zoom.
 * Nothing here aggregates a document, so it is a handful of comparisons per
 * frame and O(1) work.
 */
export function useIceCameraFrame(input: {
  readonly wiring: IceWiring;
  readonly cameraApi: IceCameraApi | null;
  readonly flight: RefObject<FlightState | null>;
}): void {
  const { wiring, cameraApi, flight } = input;

  useEffect(() => {
    const { phase, workspaceMode, liveWorkspace, rootBoardId, layerReady } = wiring;
    if (phase.kind !== "ready" || !workspaceMode || liveWorkspace === null) return;
    if (rootBoardId === null || layerReady === 0 || cameraApi === null) return;
    let handle = 0;
    let active = true;

    const tick = (now: number): void => {
      if (!active) return;
      handle = requestAnimationFrame(tick);

      // The chrome inverts this to turn a pointer into a document point, so it
      // has to track pans and flights, not just the commands that write a camera.
      const camera = cameraApi.cameraOf();
      if (camera !== null) publishScreenCamera(camera);

      const current = flight.current;
      if (current !== null) {
        const elapsed = now - current.startedAt;
        cameraApi.write(sampleFlight(current.plan, elapsed));
        if (flightDone(current.plan, elapsed)) {
          cameraApi.write(current.plan.to);
          flight.current = null;
        }
      }
    };

    handle = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [wiring, cameraApi, flight]);
}

/**
 * A middle press pans the desk, wherever it lands.
 *
 * ICE reaches its `buttons & 4` check only for a press that landed on the bare
 * canvas: a press captured by a widget with `Position` is routed as a move
 * first. A capture-phase listener on the surface root runs before the desk's
 * own listener, so a middle press over a card, a mat or any overlay is taken
 * here, and ICE never sees it at all — its pan cannot compete with this one.
 */
export function useIceMiddlePan(input: {
  readonly refs: IceSurfaceRefs;
  readonly cameraApi: IceCameraApi | null;
}): void {
  const { refs, cameraApi } = input;

  useEffect(() => {
    const dom = resolveSurface(refs);
    if (dom === null) return;
    const { root } = dom;
    /* ---------------------------------------------------------------- *
     * Middle-button panning (iceMiddlePan)
     *
     * ICE reaches its `buttons & 4` check only for a press that landed on
     * the bare canvas: a press captured by a widget with `Position` is
     * routed as a move first. A capture-phase listener on the surface root
     * runs before the desk's own listener, so a middle press over a card, a
     * mat or any overlay is taken here, and ICE never sees it at all — its
     * pan cannot compete with this one.
     * ---------------------------------------------------------------- */
    let middlePan: MiddlePanState | null = null;

    function onMiddleMove(event: PointerEvent): void {
      if (middlePan === null) return;
      const move = updateMiddlePan(middlePan, {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      });
      middlePan = { ...middlePan, moved: move.moved };
      // Sub-threshold travel is a click in waiting: nothing is written.
      if (!move.moved) return;
      cameraApi?.write(move.camera);
    }

    function stopMiddleListeners(): void {
      window.removeEventListener("pointermove", onMiddleMove);
      window.removeEventListener("pointerup", onMiddleUp);
      window.removeEventListener("pointercancel", onMiddleUp);
    }

    function onMiddleUp(event: PointerEvent): void {
      if (middlePan === null) return;
      const { pointerId } = middlePan;
      if (pointerId !== undefined && event.pointerId !== pointerId) return;
      // A click never moved the camera and a drag was already written move by
      // move, so releasing changes nothing either way.
      endMiddlePan(middlePan);
      middlePan = null;
      stopMiddleListeners();
    }

    function onMiddleDown(event: PointerEvent): void {
      if (event.button !== 1) return;
      // Before the desk: no move gesture, no focus change, no browser
      // autoscroll. The capture phase is what makes this work over a card.
      event.preventDefault();
      event.stopPropagation();
      middlePan = beginMiddlePan(
        {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          isPrimary: event.isPrimary,
        },
        cameraApi?.cameraOf() ?? null,
      );
      if (middlePan === null) return;
      window.addEventListener("pointermove", onMiddleMove);
      window.addEventListener("pointerup", onMiddleUp);
      window.addEventListener("pointercancel", onMiddleUp);
    }

    root.addEventListener("pointerdown", onMiddleDown, true);
    // A middle click over the canvas opens the browser's autoscroll widget
    // unless the press and the `auxclick` that follows are both refused.
    const onMiddleAux = (event: MouseEvent): void => {
      if (event.button === 1) event.preventDefault();
    };
    root.addEventListener("auxclick", onMiddleAux);

    return () => {
      root.removeEventListener("pointerdown", onMiddleDown, true);
      root.removeEventListener("auxclick", onMiddleAux);
      middlePan = null;
      stopMiddleListeners();
    };
  }, [refs, cameraApi]);
}
