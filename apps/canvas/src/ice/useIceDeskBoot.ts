/**
 * The desk's boot: what it takes to get a WebGPU desk on screen, and to put it
 * away again.
 *
 * The preflight (no `navigator.gpu` → no adapter → no device) is answered in
 * plain values so a lost device cannot invalidate it later; only then are the
 * ICE modules imported, the Suite kinds registered, the seed spawned and the
 * desk layer made. One `teardown` owns every exit — unmount, Reset, or a desk
 * that reported `failed` and was replaced by the fallback.
 *
 * Nothing here draws or decides: the phase, the seed report and the frame rate
 * are the HUD's data, and the engine they produced is handed to the surface's
 * hooks through `owned`.
 */

import type { WorkspaceDocument } from "@suite/graph";
import type { EngineGpu, Entity } from "@vibecook/ice";
import type { DeskLayerHandle, DeskLayerStatus } from "@vibecook/ice/desk";
import type { DeskHandle } from "@vibecook/ice/react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useThemeStore } from "../theme/useThemeStore";
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
  // One teardown for every exit: unmount, a reset, or a desk that reported
  // `failed` and was replaced by the fallback. Emptying the ref makes it
  // idempotent.
  const teardown = useCallback(() => {
    clearPendingFailure();
    clearPendingFit();
    const { engine, doc, gpu, clearCardRenderer, edges } = owned.current;
    owned.current = {};
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
      if (workspaceMode && (liveWorkspace === null || rootBoardId === null)) {
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
        owned.current = { engine, doc, gpu, clearCardRenderer };

        const report =
          liveWorkspace !== null && rootBoardId !== null
            ? seedWorkspaceDocument(engine, liveWorkspace, rootBoardId)
            : mode === "suite"
              ? seedSuiteDocument(engine)
              : seedDemoDocument(engine);
        seededEntities.current = report.entities;

        // Links are drawn after the Boards and cards exist: an edge is a line
        // between two *places*, and its frame is the lowest Board that holds
        // both ends (`edgeFrameOf`). The table is what lets the kind re-route a
        // link when a card moves, without reading the document per frame.
        const edges: EdgeSpawns | undefined =
          liveWorkspace !== null && rootBoardId !== null
            ? spawnLinkEdges(
                engine,
                liveWorkspace,
                rootBoardId,
                report.boardMats,
                suiteCardModules[4].setSuiteEdgeLinkOf,
              )
            : undefined;
        owned.current = { ...owned.current, edges };
        const layer = desk.deskLayer({
          theme: objects.deskTheme(theme),
          palette: suitePalette(objects.deskPalette(theme)),
          objects: widgets,
          docs: engine.docs,
          text: desk.inkRaster({ faces: SUITE_PEN_FACES }),
          name: `ice-demo-${runId + 1}`,
        });

        setSeed(report);
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
  }, [liveWorkspace, mode, rootBoardId, runId, teardown, workspaceMode]);

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
        if (framing) return;
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
