/**
 * The ICE surface — `?canvas=ice`.
 *
 * EXPERIMENTAL, NOT DOCUMENT TRUTH. This surface mounts a private, in-memory
 * `@vibecook/ice` desk. It has three seed sources:
 *
 * - **Live workspace** (app only): the real Suite graph, projected into cards
 *   and mini mats. It waits for hydration, then keeps the projection in step
 *   with the document: a drag or resize commits once through the bridge, and
 *   undo/redo re-derives the entities from the canonical placements. The HUD
 *   says `Live workspace`.
 * - **Native demo** (standalone `/ice.html`): ten ICE-native objects — six notes
 *   (four loose, one inside each mini mat), two mini mats, a whiteboard and a
 *   notebook.
 * - **Suite demo** (`/ice.html?demo=suite`): the same read-only projection over
 *   the example workspace built in a throwaway in-memory document.
 *
 * The live workspace projection reads the graph, and every gesture writes it
 * through the bridge in `iceBridge.ts` — one commit per gesture, never a raw
 * Loro call. The demo projections build a throwaway document; no workspace
 * write, provider or owner key is involved. ICE is the only surface: the React
 * Flow scene is deleted (ADR-0034), and this file is composition only — the
 * camera, the projection, the gestures and the layers live in the `useIce*`
 * hooks beside it.
 *
 * Route contract: `App` mounts this behind `lazy(() => import("./ice/IceSurface"))`,
 * so the default bundle never imports ICE even statically.
 *
 * Everything below the HUD is loaded on demand — a WebGPU browser is detected
 * first, and only then are `@vibecook/ice`, `/desk`, `/desk/objects` and
 * `/react` imported together. No ICE code, shader or WGSL text is reachable
 * from the app's static entry, so the default path pays nothing for the demo.
 *
 * The whiteboard (`desk.board`) ships in `DESK_OBJECTS`, but ICE 0.16.0 has no
 * public seeded-surface API: a board's ink is the `StrokePrefab` data its
 * mounted pen writes through a GuardedTx. The demo therefore spawns a blank
 * board (blue marker, bullet tip) and leaves drawing to the pointer, rather
 * than reaching into engine internals to fabricate strokes.
 *
 * The desk wears the shipped light theme and palette (paper/sketch skin), and
 * frames its seeded content on the first mount so the demo never opens on an
 * empty patch of mat.
 *
 * Handwriting is deliberately off: `deskLayer` gets no `text` raster because
 * that needs the Caveat/Kalam face files, which this app does not host, and the
 * demo must not fetch a third-party font. The seeded notes carry real text for
 * the note bodies and diagnostics; the GPU shows their paper, the mini mats and
 * their chip LOD.
 */
import type { Board, WorkspaceDocument } from "@suite/graph";

import { useEffect, useMemo, useRef, useState } from "react";

import { CanvasZoomControls } from "../components/CanvasZoomControls";
import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { IceContextMenu } from "./IceContextMenu";
import { IceSurfaceHud } from "./IceSurfaceHud";
import { iceShareCaps, withinShareScope } from "./iceShareCaps";
import { useIceCamera, useIceCameraFrame, useIceMiddlePan } from "./iceSurfaceCamera";
import { demoModeFromSearch, SUITE_PIN_KIND } from "./iceSurfaceSpawns";
import { type IceCommands, type IceSurfaceRefs, useIceWiring } from "./iceSurfaceWiring";
import { SuiteWhiteboardStage } from "./SuiteWhiteboardStage";
import { useIceBoardGesture } from "./useIceBoardGesture";
import { useIceDeskBoot } from "./useIceDeskBoot";
import { useIceLinkGesture } from "./useIceLinkGesture";
import { useIcePresence } from "./useIcePresence";
import { useIceProjection } from "./useIceProjection";
import { useIceSelection } from "./useIceSelection";
import { useIceWhiteboard } from "./useIceWhiteboard";
import "./iceSurface.css";

/** The route's demo toggle, re-exported for the tests that pin it. */
export { demoModeFromSearch };

export interface IceSurfaceFallbackProps {
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
}

/** The calm no-desk card. Exported so Storybook can show it without WebGPU. */
export function IceSurfaceFallback({ title, message, detail }: IceSurfaceFallbackProps) {
  return (
    <div className="ice-surface__state" data-testid="ice-fallback">
      <div className="ice-surface__card">
        <p className="ice-surface__card-title" data-testid="ice-fallback-title">
          {title}
        </p>
        <p className="ice-surface__card-copy" data-testid="ice-fallback-copy">
          {message}
        </p>
        {detail === undefined ? null : (
          <p className="ice-surface__card-detail" data-testid="ice-fallback-detail">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

/** The ICE mount. In the app it projects the live workspace read-only. */
export interface IceSurfaceProps {
  /** Where the fallback/HUD returns; the standalone demo overrides it to `/`. */
  /**
   * The live workspace to project. Omit for the standalone demo; `null` means
   * the app has the workspace but it is not hydrated yet, so the surface waits
   * instead of falling back to a demo.
   */
  readonly workspace?: WorkspaceDocument | null;
  /** Root board/View to frame. The surface waits while this is null. */
  readonly rootBoardId?: string | null;
}

export function IceSurface({ workspace, rootBoardId = null }: IceSurfaceProps = {}) {
  const workspaceMode = workspace !== undefined;
  const liveWorkspace = workspace ?? null;
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const readOnly = useUiStore((state) => state.readOnly);
  // One capability row for everything the surface does. The session matrix in
  // the store says what this seat may do; `iceShareCaps` narrows it to the
  // share's scope, so a board share cannot write a card on another board and a
  // card share can edit that card's text but never its placement.
  const caps = useMemo(
    () =>
      iceShareCaps({
        share: getSession().share,
        ui: { readOnly, canEditLayout, canEditContent, canManageSchema, canManageTrash },
      }),
    [readOnly, canEditLayout, canEditContent, canManageSchema, canManageTrash],
  );
  /**
   * The whole workspace, for the two things the surface must follow rather than
   * write: which Boards exist (pointer attribution) and when the document moved
   * under it (a peer's commit). The desk itself stays imperative.
   */
  const snapshot = useWorkspaceSnapshot();
  const pendingPinFocus = useUiStore((state) => state.pendingPinFocus);
  const dropPinRequest = useUiStore((state) => state.dropPinRequest);
  const actorId = useRef(`local-${Math.random().toString(36).slice(2, 10)}`);
  /**
   * The Board tree, for pointer attribution ("which Board is this peer in") and
   * for the reconcile that follows a document change. Kept beside the snapshot
   * rather than read from Loro per sample: a pointer moves at 30 Hz, a Board
   * list changes when someone edits the tree.
   */
  const boardsRef = useRef<readonly Board[]>([]);
  /** The screen-space layer host: presence and connectors, above the desk. */
  const overlaysRef = useRef<HTMLDivElement | null>(null);

  const boot = useIceDeskBoot({ workspace, rootBoardId });
  const { phase, seed, engineState, fps, copyState, mode, layerReady, handleReady } = boot;
  const { owned, deskLayerRef, resetDemo, chooseDemo, copyDiagnostics } = boot;

  const surfaceRef = useRef<HTMLElement | null>(null);
  const commandsRef = useRef<IceCommands | null>(null);
  const [portalPath, setPortalPath] = useState<readonly string[]>([]);
  const portalDepth = useRef(0);
  /** The same path with ids, which the frame contract and the debug bridge need. */
  const portalFramesRef = useRef<readonly { id: string; name: string }[]>([]);

  // The Board tree is attribution data and content bounds; a pointer sample
  // reads it 30 times a second, so it is cached rather than rebuilt.
  useEffect(() => {
    boardsRef.current = snapshot.boards;
  }, [snapshot.boards]);

  const iceCamera = useIceCamera({ phase, surfaceRef });
  const wiring = useIceWiring({
    phase,
    seed,
    layerReady,
    workspaceMode,
    liveWorkspace,
    rootBoardId,
    caps,
    cameraApi: iceCamera.cameraApi,
    flyTo: iceCamera.flyTo,
  });
  const refs = useMemo<IceSurfaceRefs>(
    () => ({ surface: surfaceRef, desk: deskLayerRef, overlays: overlaysRef }),
    [deskLayerRef],
  );

  useIceSelection(wiring);
  const projection = useIceProjection({ wiring, snapshot, commands: commandsRef, owned });
  const link = useIceLinkGesture({ wiring, refs, projection });
  useIcePresence({ wiring, refs, link, owned, boardsRef, portalFramesRef });
  const whiteboard = useIceWhiteboard({ wiring, refs });
  useIceBoardGesture({
    wiring,
    refs,
    projection,
    camera: iceCamera,
    link,
    commands: commandsRef,
    boardsRef,
    portalDepth,
    portalFramesRef,
    setPortalPath,
    openWhiteboard: whiteboard.open,
  });
  useIceCameraFrame({ wiring, cameraApi: iceCamera.cameraApi, flight: iceCamera.flight });
  useIceMiddlePan({ refs, cameraApi: iceCamera.cameraApi });

  useEffect(() => {
    if (phase.kind !== "ready" || pendingPinFocus === null) return;
    const viewport = phase.engine.world.getResource(phase.core.Viewport);
    const camera = phase.engine.world.getResource(phase.core.Camera);
    if (viewport === undefined || camera === undefined) return;
    const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    phase.core.writeRuntimeResource(phase.engine.world, phase.core.Camera, {
      x: pendingPinFocus.x - viewport.w / (2 * zoom),
      y: pendingPinFocus.y - viewport.h / (2 * zoom),
      zoom,
      gesturing: false,
    });
    useUiStore.getState().focusPinAt(null);
  }, [phase, pendingPinFocus]);

  // "Drop pin" from the shell: the canvas owns the point (the camera centre) and
  // the marker; the document owns the record.
  useEffect(() => {
    if (dropPinRequest === 0) return;
    if (phase.kind !== "ready" || !workspaceMode) return;
    if (liveWorkspace === null || rootBoardId === null) return;
    // A viewer, or a share that does not cover this board, cannot leave a marker
    // on someone else's canvas.
    if (!caps.canDropPin || !withinShareScope({ boardId: rootBoardId }, getSession().share)) return;
    const viewport = phase.engine.world.getResource(phase.core.Viewport);
    const camera = phase.engine.world.getResource(phase.core.Camera);
    if (viewport === undefined || camera === undefined) return;
    const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    const point = {
      x: camera.x + viewport.w / (2 * zoom),
      y: camera.y + viewport.h / (2 * zoom),
    };
    const count = liveWorkspace.listPins(rootBoardId).length + 1;
    try {
      const pin = liveWorkspace.createPin({
        boardId: rootBoardId,
        x: point.x,
        y: point.y,
        label: `Pin ${count}`,
        createdBy: actorId.current,
      });
      const entity = phase.engine.ops.spawnWidget(SUITE_PIN_KIND, {
        x: pin.x,
        y: pin.y,
        undoable: false,
        props: {
          pinId: pin.id,
          boardId: pin.boardId,
          label: pin.label,
          color: pin.color,
        },
      });
      if (seed !== null) seed.pinEntities.set(pin.id, entity);
    } catch (error) {
      console.warn("[ice] could not drop a pin", error);
    }
  }, [dropPinRequest, phase, workspaceMode, liveWorkspace, rootBoardId, seed, caps.canDropPin]);

  const ready = phase.kind === "ready" ? phase : null;

  const keymapOverrides = useMemo(() => {
    if (!workspaceMode) return undefined;
    return [
      {
        key: "z",
        mod: true,
        run: () => {
          commandsRef.current?.undo();
        },
      },
      {
        key: "z",
        mod: true,
        shift: true,
        run: () => {
          commandsRef.current?.redo();
        },
      },
      {
        key: "Escape",
        run: () => {
          commandsRef.current?.escape();
        },
      },
      {
        key: "Backspace",
        run: () => {
          commandsRef.current?.deleteSelection();
        },
      },
      {
        key: "Delete",
        run: () => {
          commandsRef.current?.deleteSelection();
        },
      },
    ];
  }, [workspaceMode]);

  return (
    <section
      ref={surfaceRef}
      className="ice-surface"
      data-testid="ice-surface"
      data-ice-phase={phase.kind}
      aria-label="ICE experimental canvas"
    >
      {ready === null ? (
        <div className="ice-surface__desk" data-testid="ice-desk-host" />
      ) : (
        <ready.EngineProvider engine={ready.engine}>
          <ready.Desk
            engine={ready.engine}
            layer={ready.layer}
            onReady={handleReady}
            {...(keymapOverrides ? { keymapOverrides } : {})}
            className="ice-surface__desk"
            style={{ position: "absolute", inset: 0 }}
          />
        </ready.EngineProvider>
      )}

      <div ref={overlaysRef} className="ice-surface__overlays" aria-hidden="true" />

      {workspaceMode && ready !== null ? (
        <div className="ice-surface__zoom">
          <CanvasZoomControls
            onZoomIn={(factor: number) => commandsRef.current?.zoomBy(factor)}
            onZoomOut={(factor: number) => commandsRef.current?.zoomBy(factor)}
            onFitView={() => commandsRef.current?.fitView()}
            onTypes={() => useUiStore.getState().openTypeSettings()}
          />
        </div>
      ) : null}

      {liveWorkspace !== null && rootBoardId !== null ? (
        <IceContextMenu
          workspace={liveWorkspace}
          rootBoardId={rootBoardId}
          canCreateContent={caps.canCreateCards}
          canCreateBoards={canManageSchema}
          canEditContent={caps.canEditContent}
          canEditLayout={caps.canWriteLayout}
          canManageStructure={canEditLayout}
          canManageTrash={canManageTrash && caps.canWriteLayout}
          canManageLinks={canManageSchema}
          reconcile={() => commandsRef.current?.reconcile()}
        />
      ) : null}

      {whiteboard.stage === null ? null : <SuiteWhiteboardStage {...whiteboard.stage} />}

      {phase.kind === "checking" ? (
        <IceSurfaceFallback
          title="Checking for WebGPU"
          message="ICE needs WebGPU before it can start. Nothing has been loaded yet."
        />
      ) : null}

      {phase.kind === "loading" ? (
        <IceSurfaceFallback
          title="Starting the ICE desk"
          message="Importing the engine and acquiring the GPU. This is a one-time cost; the default canvas never pays it."
        />
      ) : null}

      {phase.kind === "unavailable" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "api" ? "This browser has no WebGPU" : "WebGPU has no graphics adapter"
          }
          message="ICE is an experimental WebGPU engine, so the desk cannot start here. Run `pnpm dev:ice` and open the printed URL in a headed Chrome started with `--enable-unsafe-webgpu` (`node scripts/ice-chrome.mjs` does both for you). The integrated browser and headless Chrome will not work."
          detail={
            phase.reason === "api"
              ? `${phase.detail} Try Chrome 113+, Edge 113+, or Safari 26+ with hardware acceleration on.`
              : `${phase.detail} Check that hardware acceleration is on and a supported GPU is present.`
          }
        />
      ) : null}

      {phase.kind === "failed" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "device-lost" ? "The graphics device was lost" : "ICE could not start"
          }
          message={
            phase.reason === "device-lost"
              ? "ICE stopped drawing because the graphics device went away. Nothing was written to your workspace. Reset demo rebuilds the desk."
              : "The desk failed before it could draw. Nothing was written to your workspace. Reset demo retries; if it keeps failing, run `pnpm dev:ice` in a headed Chrome with `--enable-unsafe-webgpu` (`node scripts/ice-chrome.mjs`)."
          }
          detail={phase.detail}
        />
      ) : null}

      <IceSurfaceHud
        phase={phase}
        engineState={engineState}
        seed={seed}
        fps={fps}
        mode={mode}
        workspaceMode={workspaceMode}
        copyState={copyState}
        portalPath={portalPath}
        onChooseDemo={chooseDemo}
        onReset={resetDemo}
        onCopyDiagnostics={() => {
          void copyDiagnostics();
        }}
      />
    </section>
  );
}

export default IceSurface;
