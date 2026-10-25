/**
 * The desk's boot: what it takes to get a WebGPU desk on screen, and to put it
 * away again.
 *
 * The preflight (no `navigator.gpu` → no adapter → no device) is answered in
 * plain values so a lost device cannot invalidate it later; only then are the
 * ICE modules imported, the Suite kinds registered and the desk layer made. The
 * seed is staged into that desk on every boot and re-staged, into the *same*
 * engine, when the View changes: which View a desk frames is content, not
 * lifecycle. One `teardown` owns every exit — unmount, Reset, or a desk that
 * reported `failed` and was replaced by the fallback.
 *
 * Nothing here draws or decides: the phase, the seed report and the frame rate
 * are the HUD's data, and the engine they produced is handed to the surface's
 * hooks through `owned`.
 */

import type { WorkspaceDocument } from "@suite/graph";
import type { CanvasEngine, EngineGpu, Entity } from "@vibecook/ice";
import type { DeskLayerHandle, DeskLayerStatus } from "@vibecook/ice/desk";
import type { DeskHandle } from "@vibecook/ice/react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useThemeStore } from "../theme/useThemeStore";
import { reseedBoardTree } from "./iceBoardReseed";
import { workspaceStructureKey } from "./iceBoardTree";
import { restoreEnteredPath, storedViewStanding } from "./iceEnteredPath";
import { worldOf } from "./iceSurfaceCamera";
import { describeError, quietly } from "./iceSurfaceShared";
import {
  type DemoMode,
  demoModeFromSearch,
  type EdgeSpawns,
  type SeedReport,
  seedDemoDocument,
  seedSuiteDocument,
  seedWorkspaceDocument,
  spawnLinkEdges,
} from "./iceSurfaceSpawns";
import {
  type AdapterSummary,
  adapterInfoOf,
  diagnosticsText,
  type EngineState,
  FAILED_SETTLE_MS,
  FIT_SETTLE_MS,
  type GpuAdapter,
  type Phase,
  summarizeAdapter,
  webGpuApi,
} from "./iceSurfaceStatus";
import type { IceOwned } from "./iceSurfaceWiring";
import { applySuiteDeskLight, type SuiteLightDesk } from "./suiteDeskLight";
import { applySuiteDeskTheme, type SuiteDeskSurface } from "./suiteDeskTheme";
import { SUITE_CARD_DOM_FACE, SUITE_PEN_FACES, suitePalette } from "./suitePen";

export interface IceDeskBoot {
  readonly phase: Phase;
  readonly seed: SeedReport | null;
  readonly engineState: EngineState | null;
  readonly fps: number | null;
  readonly copyState: string | null;
  readonly mode: DemoMode;
  /** Bumped when the desk is rebuilt, so the layer gets a fresh name. */
  readonly layerReady: number;
  /** The engine, document and device the desk lives on; released by `teardown`. */
  readonly owned: RefObject<IceOwned>;
  readonly deskLayerRef: RefObject<DeskLayerHandle | null>;
  readonly handleReady: (handle: DeskHandle) => (() => void) | undefined;
  readonly resetDemo: () => void;
  readonly chooseDemo: (next: DemoMode) => void;
  readonly copyDiagnostics: () => Promise<void>;
}

export function useIceDeskBoot(input: {
  readonly workspace: WorkspaceDocument | null | undefined;
  readonly rootBoardId: string | null;
}): IceDeskBoot {
  const { workspace, rootBoardId } = input;
  const workspaceMode = workspace !== undefined;
  const liveWorkspace = workspace ?? null;
  /**
   * Whether a root Board is known. The *presence* of a View is what a boot
   * waits for; which View it is only decides what gets seeded, so switching
   * Views keeps the engine, the device and the camera.
   */
  const hasRoot = rootBoardId !== null;
  const [mode, setMode] = useState<DemoMode>(() =>
    demoModeFromSearch(typeof window === "undefined" ? "" : window.location.search),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [seed, setSeed] = useState<SeedReport | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  // The desk follows the app's theme: the mat is neutral in both, and the only
  // coloured things on it are what the user put down (see `suiteDeskTheme.ts`).
  const theme = useThemeStore((state) => state.theme);
  const [runId, setRunId] = useState(0);
  const owned = useRef<IceOwned>({});
  const pendingFailure = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingFit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seededEntities = useRef<readonly Entity[]>([]);
  /** The `suite.edge` kind's link table, so a re-seed can replace the links. */
  const setEdgeLinkOf = useRef<Parameters<typeof spawnLinkEdges>[4] | null>(null);
  const deskLayerRef = useRef<DeskLayerHandle | null>(null);
  const [layerReady, setLayerReady] = useState(0);

  const clearPendingFailure = useCallback(() => {
    if (pendingFailure.current === undefined) return;
    clearTimeout(pendingFailure.current);
    pendingFailure.current = undefined;
  }, []);
  const clearPendingFit = useCallback(() => {
    if (pendingFit.current === undefined) return;
    clearTimeout(pendingFit.current);
    pendingFit.current = undefined;
  }, []);
  /**
   * What the desk is currently showing, so a seed is not repeated for the same
   * engine, View and demo. The stage survives a View switch (same engine, new
   * root); it dies with the engine.
   */
  const staged = useRef<{
    engine: CanvasEngine;
    rootBoardId: string | null;
    mode: DemoMode;
    /** The Board tree the seed was built from; see `iceBoardTree.ts`. */
    structure: string | null;
  } | null>(null);
  /** The seed the desk is showing, for the restore that runs before `ready`. */
  const stagedReport = useRef<SeedReport | null>(null);
  /**
   * Whether the boot put the desk back where the View was left. The boot's own
   * framing (`frameDemo`) must not run then: it would refit the content and
   * throw the reader out of the frame the document restored.
   */
  const restoredView = useRef(false);

  /**
   * The desk's *contents*: the seed and the links, spawned into an engine. The
   * boot calls this before it publishes `ready`, the effect below calls it
   * again when the View changes, and a re-seed calls it when the Board tree
   * changed — always into the same engine, which is what keeps the device and
   * the camera across a View switch or a rebuild.
   *
   * `force` is the one difference between "the View changed" and "the Board
   * tree changed": both replace the contents, but only the second one is
   * already standing in the right View, so it arrives here with a seat to keep
   * (`iceBoardReseed.ts`).
   */
  const stageSeed = useCallback(
    (engine: CanvasEngine, options?: { readonly force?: boolean }): void => {
      const current = staged.current;
      const structure = workspaceStructureKey(liveWorkspace, rootBoardId);
      if (
        options?.force !== true &&
        current !== null &&
        current.engine === engine &&
        current.rootBoardId === rootBoardId &&
        current.mode === mode &&
        current.structure === structure
      ) {
        return;
      }

      // The previous stage goes first: a View switch replaces the desk's
      // contents rather than stacking a second copy on top of them.
      const previous = seededEntities.current;
      seededEntities.current = [];
      const previousEdges: EdgeSpawns | undefined = owned.current.edges;
      owned.current = { ...owned.current, edges: undefined };
      previousEdges?.dispose();
      if (previous.length > 0) {
        quietly(() => {
          engine.ops.setSelection([...previous]);
          engine.ops.deleteSelection();
        });
      }

      const report =
        liveWorkspace !== null && rootBoardId !== null
          ? seedWorkspaceDocument(engine, liveWorkspace, rootBoardId)
          : mode === "suite"
            ? seedSuiteDocument(engine)
            : seedDemoDocument(engine);
      seededEntities.current = report.entities;

      // Links are drawn after the Boards and cards exist: an edge is a line
      // between two *places*, and its frame is the lowest Board that holds both
      // ends (`edgeFrameOf`). The table is what lets the kind re-route a link
      // when a card moves, without reading the document per frame.
      const linkOf = setEdgeLinkOf.current;
      const edges: EdgeSpawns | undefined =
        liveWorkspace !== null && rootBoardId !== null && linkOf !== null
          ? spawnLinkEdges(engine, liveWorkspace, rootBoardId, report.boardMats, linkOf)
          : undefined;
      owned.current = { ...owned.current, edges, structure };

      staged.current = { engine, rootBoardId, mode, structure };
      stagedReport.current = report;
      setSeed(report);
    },
    [liveWorkspace, mode, rootBoardId],
  );
  // The boot runs from an async continuation, so it reads the newest seeder
  // rather than the one captured when it started.
  const stageSeedRef = useRef(stageSeed);
  useEffect(() => {
    stageSeedRef.current = stageSeed;
  }, [stageSeed]);

  /**
   * Rebuild the desk from the document, keeping the seat: the same engine, the
   * same camera, the same entered Board. Only the Board tree's shape gets here
   * — a mat is a container ICE compiles an inside frame for, so it cannot be
   * reconciled card by card the way a placement can.
   *
   * This is deliberately *not* the boot's View-switch path: a View switch
   * re-seeds `restoredView` free and lets the fit decide, while a rebuild is a
   * reader staying exactly where they are. Nothing here touches `restoredView`,
   * and the camera is written back rather than fitted.
   */
  const reseed = useCallback(
    (engine: CanvasEngine, core: typeof import("@vibecook/ice")): void => {
      if (liveWorkspace === null || rootBoardId === null) return;
      const world = worldOf(engine);
      if (world === undefined) return;
      reseedBoardTree({
        engine,
        boards: liveWorkspace.listBoards(),
        rootBoardId,
        mats: stagedReport.current?.boardMats ?? new Map(),
        replace: () => {
          stageSeedRef.current(engine, { force: true });
          return stagedReport.current;
        },
        // The camera is read here, in the frame the reader is standing in, and
        // written back by the reseed only when that frame survived.
        readCamera: () => {
          const view = world.getResource(core.Camera);
          if (view === undefined) return null;
          const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
          return { x: view.x, y: view.y, zoom };
        },
        writeCamera: (camera) => {
          core.writeRuntimeResource(world, core.Camera, { ...camera, gesturing: false });
        },
      });
    },
    [liveWorkspace, rootBoardId],
  );
  // A rebuild is asked for from the surface (the projection compares the Board
  // tree); the engine and the ICE module are what it needs, not React state.
  const reseedRef = useRef(reseed);
  useEffect(() => {
    reseedRef.current = reseed;
  }, [reseed]);

  // One teardown for every exit: unmount, a reset, or a desk that reported
  // `failed` and was replaced by the fallback. Emptying the ref makes it
  // idempotent.
  const teardown = useCallback(() => {
    clearPendingFailure();
    clearPendingFit();
    const { engine, doc, gpu, clearCardRenderer, edges } = owned.current;
    owned.current = {};
    // The entities died with the engine; the next seed starts from nothing.
    seededEntities.current = [];
    staged.current = null;
    stagedReport.current = null;
    restoredView.current = false;
    edges?.dispose();
    clearCardRenderer?.();
    if (doc !== undefined) quietly(() => doc.close());
    if (engine !== undefined) quietly(() => engine.dispose());
    if (gpu !== undefined) quietly(() => gpu.destroy());
  }, [clearPendingFailure, clearPendingFit]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `theme` is read once, at mount; the theme effect repaints
  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const gpu = webGpuApi();
      if (gpu === undefined) {
        setPhase({
          kind: "unavailable",
          reason: "api",
          detail: "navigator.gpu is not exposed by this browser.",
        });
        return;
      }

      // In the app, a workspace that has not hydrated yet is not a reason to
      // show a demo. Wait for the real graph; the boot skeleton stays up.
      if (workspaceMode && (liveWorkspace === null || !hasRoot)) {
        setPhase({ kind: "checking" });
        return;
      }

      setPhase({ kind: "loading" });

      let raw: GpuAdapter | null;
      try {
        raw = await gpu.requestAdapter();
      } catch (error) {
        if (!cancelled) {
          setPhase({
            kind: "unavailable",
            reason: "adapter",
            detail: `requestAdapter() failed: ${describeError(error)}`,
          });
        }
        return;
      }
      if (cancelled) return;
      if (raw === null) {
        setPhase({
          kind: "unavailable",
          reason: "adapter",
          detail: "requestAdapter() returned no adapter.",
        });
        return;
      }

      const adapter = summarizeAdapter(await adapterInfoOf(raw));
      if (cancelled) return;
      setPhase({ kind: "loading", adapter });

      let deviceAdapter: AdapterSummary | undefined;
      try {
        const [core, desk, objects, react] = await Promise.all([
          import("@vibecook/ice"),
          import("@vibecook/ice/desk"),
          import("@vibecook/ice/desk/objects"),
          import("@vibecook/ice/react"),
        ]);
        if (cancelled) return;

        // The Suite kinds are loaded for **every** surface, demo included: the
        // demo projects the same example, so a Board is a `suite.board` there
        // too. A kind that is not registered fails its spawn and takes its
        // children with it, which is exactly how the demo went blank once.
        const suiteCardModules = await Promise.all([
          import("./suiteCardKind"),
          import("./suiteCardWorkspace"),
          import("./suitePinKind"),
          import("./suiteBoardKind"),
          import("./suiteEdgeKind"),
        ]);
        if (cancelled) return;
        // Every rung of the card's type ladder is its own kind (ICE fixes a
        // note's type size per kind), so all of them are registered, and
        // `suite.board` is the frame a Board is drawn as.
        const widgets = [
          ...objects.DESK_OBJECTS,
          ...suiteCardModules[0].SUITE_CARD_RUNGS.map((rung) => rung.object),
          suiteCardModules[2].SuitePin,
          suiteCardModules[3].SuiteBoard,
          suiteCardModules[4].SuiteEdge,
        ];

        // ONE device per engine (D7): the desk adopts this one instead of
        // acquiring its own, so a discarded StrictMode mount cannot destroy
        // the device the retained mount is drawing with. The app owns its end
        // of life — `teardown` releases it after the engine is disposed.
        let gpu: EngineGpu;
        try {
          gpu = await core.acquireCompositorDevice();
        } catch (error) {
          if (!cancelled) {
            setPhase({
              kind: "unavailable",
              reason: "adapter",
              detail: `Could not create a WebGPU device: ${describeError(error)}`,
            });
          }
          return;
        }
        if (cancelled) {
          quietly(() => gpu.destroy());
          return;
        }
        owned.current = { gpu };

        deviceAdapter = summarizeAdapter(await adapterInfoOf(gpu.adapter));
        if (cancelled) return;
        setPhase({ kind: "loading", adapter: deviceAdapter });

        const engine = core.createCanvasEngine({
          ...objects.DESK_ENGINE,
          widgets,
          compositorDevice: gpu,
        });
        const doc = engine.docs.create();
        let clearCardRenderer: (() => void) | undefined;
        if (SUITE_CARD_DOM_FACE) {
          suiteCardModules[0].setSuiteCardSlotRenderer(
            suiteCardModules[1].createWorkspaceCardSlotRenderer(),
          );
          clearCardRenderer = () => suiteCardModules[0].setSuiteCardSlotRenderer(undefined);
        }
        owned.current = {
          engine,
          doc,
          gpu,
          clearCardRenderer,
          // The projection rebuilds the desk when the Board tree moves under
          // it; the engine and the loaded module are all a rebuild needs.
          reseed: () => reseedRef.current(engine, core),
          // Our own Board write: the mat is already right, so record the key the
          // document now has and let the projection's comparison match.
          recordStructure: () => {
            if (liveWorkspace === null || rootBoardId === null) return;
            owned.current = {
              ...owned.current,
              structure: workspaceStructureKey(liveWorkspace, rootBoardId),
            };
          },
        };
        // The links are spawned by the seed effect, which also has to re-spawn
        // them when the View changes; it reaches the kind's table through here.
        setEdgeLinkOf.current = suiteCardModules[4].setSuiteEdgeLinkOf;

        const layer = desk.deskLayer({
          theme: objects.deskTheme(theme),
          palette: suitePalette(objects.deskPalette(theme)),
          objects: widgets,
          docs: engine.docs,
          text: desk.inkRaster({ faces: SUITE_PEN_FACES }),
          name: `ice-demo-${runId + 1}`,
        });

        // The contents exist before the desk is published, so `ready` never
        // means "a desk with nothing on it".
        stageSeedRef.current(engine);

        // Where the View was left, restored into this engine before `ready`
        // publishes: entering the Boards it was inside and writing back the
        // camera it held, so the first painted frame is already the right one.
        // A View that never moved, a path a peer broke, or a camera the desk
        // cannot stand in all fall back to the boot fit below.
        restoredView.current = false;
        const standing =
          liveWorkspace === null ? null : storedViewStanding(liveWorkspace, rootBoardId);
        const report = stagedReport.current;
        const world = worldOf(engine);
        if (standing !== null && report !== null && world !== undefined) {
          // The pose Escape should return to is the one the reader left the
          // plane with; writing it before entering makes ICE save it on the nav
          // entry, exactly as the in-session double-click would have.
          if (standing.returnCamera !== null) {
            quietly(() =>
              core.writeRuntimeResource(world, core.Camera, {
                ...standing.returnCamera,
                gesturing: false,
              }),
            );
          }
          // Only when every level was entered does the camera belong to the
          // frame the reader is now in; a broken path falls back to the fit.
          if (restoreEnteredPath(engine, report.boardMats, standing.path)) {
            try {
              core.writeRuntimeResource(world, core.Camera, {
                ...standing.camera,
                gesturing: false,
              });
              restoredView.current = true;
            } catch {
              // A desk that cannot take the camera yet fits instead.
              restoredView.current = false;
            }
          } else if (engine.nav.depth() > 0) {
            // A path a peer broke must not strand the reader in a partial
            // frame: walk back to the plane, where the fit can frame the View.
            quietly(() => engine.ops.exitTo(0, { transition: "none" }));
          }
        }

        setPhase({
          kind: "ready",
          adapter: deviceAdapter ?? adapter,
          engine,
          layer,
          Desk: react.Desk,
          EngineProvider: react.EngineProvider,
          core,
          objects,
        });
      } catch (error) {
        if (!cancelled) {
          setPhase({
            kind: "failed",
            reason: "engine",
            detail: describeError(error),
            adapter: deviceAdapter ?? adapter,
          });
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      teardown();
    };
    // The root Board is deliberately absent: switching a View must not tear the
    // desk down (that costs the device and the camera). The seed effect below
    // re-seeds the same engine instead.
  }, [liveWorkspace, runId, teardown, workspaceMode, hasRoot]);

  /**
   * A View switch re-seeds the same engine: `stageSeed` is identity-stable per
   * (engine, View, demo), so this is a no-op right after a boot and the actual
   * re-seed when the root Board changes.
   */
  useEffect(() => {
    if (phase.kind !== "ready") return;
    // A boot that is restarting has already released its engine; nothing may be
    // seeded into a desk that is on its way out.
    if (owned.current.engine !== phase.engine) return;
    stageSeed(phase.engine);
  }, [phase, stageSeed]);

  // A desk that reported `failed` is replaced by the fallback, so its engine
  // is released here rather than held until the route changes.
  useEffect(() => {
    if (phase.kind === "failed") teardown();
  }, [phase.kind, teardown]);

  // FPS is sampled in a rAF counter and published once per second, never per
  // frame: the HUD must not make React the desk's frame loop.
  useEffect(() => {
    if (phase.kind !== "ready" || typeof requestAnimationFrame !== "function") return;
    let handle = 0;
    let frames = 0;
    let since = performance.now();
    const tick = (now: number): void => {
      frames += 1;
      const elapsed = now - since;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        since = now;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [phase.kind]);

  /**
   * The desk reports its own boot and device loss. A `failed` desk is replaced
   * by the fallback (the engine is disposed with it); `degraded` keeps drawing
   * and says so in the HUD.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is read at submit time and repainted by the theme effect
  const handleReady = useCallback(
    (handle: DeskHandle) => {
      const layer = handle.layer as Partial<DeskLayerHandle>;
      deskLayerRef.current = layer as DeskLayerHandle;
      setLayerReady((count) => count + 1);
      let active = true;
      let framing = false;
      const frameDemo = (): void => {
        // A restored View is already framed: fitting now would move a reader
        // who reloaded back to where the document says they were standing.
        if (framing || restoredView.current) return;
        framing = true;
        pendingFit.current = setTimeout(() => {
          pendingFit.current = undefined;
          if (!active || seededEntities.current.length === 0) return;
          quietly(() => handle.engine.ops.zoomToFit(seededEntities.current));
        }, FIT_SETTLE_MS);
      };
      const apply = (status: DeskLayerStatus): void => {
        if (!active) return;
        setEngineState(status.state);
        clearPendingFailure();
        if (status.state === "ready") {
          // The ground and the light: a neutral mat, and the desk's own
          // tree-shadow dapple switched off (it can only ever be a splotch on an
          // infinite canvas — see `suiteDeskLight.ts`).
          quietly(() => {
            applySuiteDeskTheme(layer as SuiteDeskSurface, theme);
            applySuiteDeskLight(layer as SuiteLightDesk);
          });
          frameDemo();
        }
        if (status.state !== "failed") return;
        pendingFailure.current = setTimeout(() => {
          pendingFailure.current = undefined;
          if (!active) return;
          setPhase((current) => ({
            kind: "failed",
            reason: "device-lost",
            detail: status.message ?? "The desk lost its graphics device.",
            adapter: current.kind === "ready" ? current.adapter : undefined,
          }));
        }, FAILED_SETTLE_MS);
      };

      if (typeof layer.status === "function") apply(layer.status());
      const stop = typeof layer.onStatus === "function" ? layer.onStatus(apply) : undefined;
      return () => {
        active = false;
        deskLayerRef.current = null;
        clearPendingFailure();
        clearPendingFit();
        stop?.();
      };
    },
    [clearPendingFailure, clearPendingFit],
  );

  const resetDemo = useCallback(() => {
    setPhase({ kind: "checking" });
    setEngineState(null);
    setSeed(null);
    setFps(null);
    setCopyState(null);
    seededEntities.current = [];
    clearPendingFit();
    setRunId((id) => id + 1);
  }, [clearPendingFit]);

  /** Switching demos is a Reset: the desk, document and device are rebuilt. */
  const chooseDemo = useCallback(
    (next: DemoMode) => {
      if (next === mode) return;
      setMode(next);
      resetDemo();
    },
    [mode, resetDemo],
  );

  const copyDiagnostics = useCallback(async (): Promise<void> => {
    const text = diagnosticsText({ phase, engineState, seed, fps });
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (clipboard === undefined) throw new Error("clipboard is unavailable in this browser");
      await clipboard.writeText(text);
      setCopyState("Diagnostics copied");
    } catch (error) {
      setCopyState(`Copy failed: ${describeError(error)}`);
    }
  }, [phase, engineState, seed, fps]);

  return {
    phase,
    seed,
    engineState,
    fps,
    copyState,
    mode,
    layerReady,
    owned,
    deskLayerRef,
    handleReady,
    resetDemo,
    chooseDemo,
    copyDiagnostics,
  };
}
