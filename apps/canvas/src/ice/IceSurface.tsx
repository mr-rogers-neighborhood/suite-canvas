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

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CanvasZoomControls } from "../components/CanvasZoomControls";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "../hooks/useLibrarySearch";
import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { IceContextMenu } from "./IceContextMenu";
import { IceSurfaceHud } from "./IceSurfaceHud";
import { describeIceKeys, type IceCommandId, iceKeymapEntries } from "./iceKeys";
import { ICE_NUDGE_STEP, ICE_NUDGE_STEP_FAR } from "./iceNudge";
import { iceShareCaps, withinShareScope } from "./iceShareCaps";
import { useIceCamera, useIceCameraFrame, useIceMiddlePan } from "./iceSurfaceCamera";
import { demoModeFromSearch, SUITE_PIN_KIND } from "./iceSurfaceSpawns";
import { type IceCommands, type IceSurfaceRefs, useIceWiring } from "./iceSurfaceWiring";
import { SuiteWhiteboardStage, type SuiteWhiteboardStageBox } from "./SuiteWhiteboardStage";
import { useIceBoardGesture } from "./useIceBoardGesture";
import { useIceCardEditing } from "./useIceCardEditing";
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
  /**
   * Where a reader can read the requirements, when the state has a fix outside
   * this app. ADR-0034's unsupported screen promises a link, not just prose.
   */
  readonly requirements?: { readonly href: string; readonly label: string } | undefined;
}

/** The one screen-reader-only style this file needs. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** The calm no-desk card. Exported so Storybook can show it without WebGPU. */
export function IceSurfaceFallback({
  title,
  message,
  detail,
  requirements,
}: IceSurfaceFallbackProps) {
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
        {requirements === undefined ? null : (
          <p className="ice-surface__card-copy">
            <a
              data-testid="ice-fallback-requirements"
              href={requirements.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {requirements.label}
            </a>
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
  // What the accessible summary carries beside the View's name.
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
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
  // The one in-place text editor (ADR-0042). It reads the store's editing
  // protocol, so the inspector, the focus surface and this editor can never be
  // open on the same card at once; the whiteboard stage is the other DOM editor,
  // and the two close each other.
  const editing = useIceCardEditing({
    wiring,
    refs,
    commands: commandsRef,
    framePath: portalPath,
    closeWhiteboard: whiteboard.close,
  });
  const openWhiteboard = useCallback(
    (cardId: string, box: SuiteWhiteboardStageBox): void => {
      editing.close();
      whiteboard.open(cardId, box);
    },
    [editing.close, whiteboard.open],
  );
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
    owned,
    setPortalPath,
    openWhiteboard,
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

  /**
   * Cmd/Ctrl+K — the canvas's own search. The Dock owns the app-wide shortcut,
   * and this override adds the two things a canvas search means: scope the
   * library to the View on screen, and reveal whatever result is chosen. The
   * drawer owns its input, so it focuses on this event rather than being handed
   * a ref it does not expose.
   */
  const openSearch = useCallback(() => {
    const store = useUiStore.getState();
    // The drawer is not rendered for a read-only seat, so there is nothing to
    // open; searching is the library's surface, not the canvas's.
    if (store.readOnly) return;
    store.setLibraryTab("cards");
    store.setLibraryScope("board");
    store.setLibraryReveal(true);
    store.setLibraryOpen(true);
    window.dispatchEvent(new Event(LIBRARY_SEARCH_FOCUS_EVENT));
  }, []);

  /**
   * Cmd/Ctrl+K is bound here rather than through ICE's keymap.
   *
   * The shell's Dock already listens for it on `window`, and it attaches before
   * this lazily-mounted surface does — so it runs first, calls `preventDefault`,
   * and ICE (which cedes any default-prevented event) would drop the override.
   * A capture-phase listener on the surface avoids the race entirely: it runs
   * before the Dock's, and a key pressed inside an editable target is left
   * alone, which is how the editor keeps its own ⌘K.
   */
  useEffect(() => {
    if (!workspaceMode) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [workspaceMode, openSearch]);

  /**
   * The keyboard is one table (`iceKeys.ts`): every entry is an override of an
   * ICE default, because ICE's own arrows nudge its ECS document, its ⌘D
   * duplicates into it and its ⌘Z undoes it. The handlers below are the only
   * place a key becomes a suite command.
   */
  const keymapOverrides = useMemo(() => {
    if (!workspaceMode) return undefined;
    const nudge = (dx: number, dy: number) => () => commandsRef.current?.nudge(dx, dy);
    const handlers: Record<IceCommandId, () => void> = {
      undo: () => commandsRef.current?.undo(),
      redo: () => commandsRef.current?.redo(),
      delete: () => commandsRef.current?.deleteSelection(),
      trash: () => commandsRef.current?.trashSelection?.(),
      escape: () => commandsRef.current?.escape(),
      copy: () => commandsRef.current?.copy(),
      cut: () => commandsRef.current?.cut(),
      paste: () => commandsRef.current?.paste(),
      duplicate: () => commandsRef.current?.duplicate(),
      "nudge-left": nudge(-ICE_NUDGE_STEP, 0),
      "nudge-right": nudge(ICE_NUDGE_STEP, 0),
      "nudge-up": nudge(0, -ICE_NUDGE_STEP),
      "nudge-down": nudge(0, ICE_NUDGE_STEP),
      "nudge-left-far": nudge(-ICE_NUDGE_STEP_FAR, 0),
      "nudge-right-far": nudge(ICE_NUDGE_STEP_FAR, 0),
      "nudge-up-far": nudge(0, -ICE_NUDGE_STEP_FAR),
      "nudge-down-far": nudge(0, ICE_NUDGE_STEP_FAR),
      search: openSearch,
    };
    return iceKeymapEntries(handlers);
  }, [workspaceMode, openSearch]);

  /*
   * Accessibility, honestly.
   *
   * The desk is drawn by WebGPU: the cards, their titles and their affordances
   * are not DOM, so a screen reader cannot walk them however the markup is
   * arranged. What is genuinely available is the shell around the canvas — a
   * named region with a description, a live summary of the view, how much is on
   * it and what is selected, and a keyboard list that matches the keymap. Do not
   * describe this canvas as accessible; its meaning is carried by the library,
   * the inspector and this summary.
   */
  // The View on screen is the root Board the shell handed the surface: a View is
  // a camera over the same Boards (`rootBoardId`), not the store's saved-view
  // filter, which is a library query and may be null.
  const viewName = useMemo(
    () =>
      snapshot.views.find((view) => view.id === rootBoardId)?.name ??
      snapshot.boards.find((board) => board.id === rootBoardId)?.name ??
      null,
    [snapshot.views, snapshot.boards, rootBoardId],
  );
  const surfaceSummary = `${
    viewName ?? "The canvas"
  }: ${snapshot.placements.length} cards placed on ${snapshot.boards.length} boards, ${
    selectedNodeIds.length
  } selected.`;
  const surfaceDescription = useMemo(
    () =>
      "A canvas drawn with WebGPU. Its cards are not in the accessibility tree, so read them in the library (Control or Command K) or the inspector. Keys: " +
      `${describeIceKeys()}.`,
    [],
  );

  return (
    <section
      ref={surfaceRef}
      className="ice-surface"
      data-testid="ice-surface"
      data-ice-phase={phase.kind}
      aria-label="ICE experimental canvas"
      aria-describedby="ice-surface-description"
    >
      <p id="ice-surface-description" style={VISUALLY_HIDDEN} data-testid="ice-surface-help">
        {surfaceDescription}
      </p>
      <div
        style={VISUALLY_HIDDEN}
        data-testid="ice-surface-summary"
        role="status"
        aria-live="polite"
      >
        {surfaceSummary}
      </div>
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

      {/* The one place writing happens on the canvas: a real card face over the
          card's sheet, kept above the desk and inside the surface's own tree. */}
      {editing.editor}

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
          onBoardWrite={() => commandsRef.current?.noteBoardWrite?.()}
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
          requirements={{
            href: "https://caniuse.com/webgpu",
            label: "Which browsers have WebGPU",
          }}
        />
      ) : null}

      {phase.kind === "failed" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "device-lost" ? "The graphics device was lost" : "ICE could not start"
          }
          message={
            phase.reason === "device-lost"
              ? `ICE stopped drawing because the graphics device went away. Nothing was written to your workspace. ${workspaceMode ? "Reload workspace" : "Reset demo"} builds the desk again.`
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
