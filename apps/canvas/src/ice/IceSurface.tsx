/**
 * The ICE spike surface — `?canvas=ice` (ADR-0032 amendment, 2026-10-23).
 *
 * EXPERIMENTAL, NOT DOCUMENT TRUTH. This surface mounts a private, in-memory
 * `@vibecook/ice` desk: it seeds two notes and a mini mat to demonstrate
 * containers and far-LOD chips, and it never reads or writes Suite's graph.
 * The default canvas and `?canvas=scene` remain the only real surfaces.
 *
 * Route contract: `App` mounts this only when `currentCanvasSurface()` returns
 * `"ice"`, behind `lazy(() => import("./ice/IceSurface"))`, so the default
 * bundle never imports ICE even statically.
 *
 * Everything below the HUD is loaded on demand — a WebGPU browser is detected
 * first, and only then are `@vibecook/ice`, `/desk`, `/desk/objects` and
 * `/react` imported together. No ICE code, shader or WGSL text is reachable
 * from the app's static entry, so the default path pays nothing for the spike.
 *
 * Handwriting is deliberately off: `deskLayer` gets no `text` raster because
 * that needs the Caveat/Kalam face files, which this app does not host, and the
 * spike must not fetch a third-party font. The seeded notes show their paper,
 * the mini mat and its chip LOD; they do not show glyphs.
 */
import type { CanvasEngine, DocSession, SpawnWidgetOpts } from "@vibecook/ice";
import type { DeskLayerFactory, DeskLayerHandle, DeskLayerStatus } from "@vibecook/ice/desk";
import type {
  DeskHandle,
  Desk as IceDesk,
  EngineProvider as IceEngineProvider,
} from "@vibecook/ice/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./iceSurface.css";

const NOTE_TYPE = "desk.note";
const MINIMAT_TYPE = "desk.minimat";
const SEED_OBJECT_COUNT = 3;

interface WebGpuApi {
  requestAdapter(): Promise<unknown>;
}

interface LoadedIce {
  readonly engine: CanvasEngine;
  readonly layer: DeskLayerFactory;
  readonly Desk: typeof IceDesk;
  readonly EngineProvider: typeof IceEngineProvider;
  /** What the in-memory document was seeded with, for the HUD. */
  readonly seed: string;
}

type Phase =
  | { readonly kind: "checking" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly reason: "api" | "adapter"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string }
  | ({ readonly kind: "ready" } & LoadedIce);

type EngineState = DeskLayerStatus["state"];

/** `navigator.gpu` without depending on `@webgpu/types` being ambient. */
function webGpuApi(): WebGpuApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  const gpu = (navigator as Navigator & { readonly gpu?: WebGpuApi }).gpu;
  return gpu;
}

/** The scene surface, keeping the workspace and any other parameter intact. */
function sceneSurfaceHref(): string {
  if (typeof window === "undefined") return "?canvas=scene";
  const url = new URL(window.location.href);
  url.searchParams.set("canvas", "scene");
  return `${url.pathname}${url.search}${url.hash}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

function quietly(run: () => void): void {
  try {
    run();
  } catch {
    // Teardown is best-effort: a failing close must not mask the surface's state.
    return;
  }
}

/**
 * Seeds the demo document. A container (mini mat) holding a note is the point:
 * it exercises ICE's nested canvas, the chip far-LOD and the zoom-through
 * without involving any Suite data. Each spawn is independent so one refusing
 * kind still leaves the rest of the desk usable.
 */
function seedSpikeDocument(engine: CanvasEngine): string {
  let seeded = 0;
  const failures: string[] = [];

  // The projection is what registers a new document's root frame and, after a
  // spawn, the container frame a child needs. Seeding runs before the desk's
  // host exists, so it drives the two steps the host would otherwise drive.
  const project = (): void => {
    try {
      engine.step(performance.now());
    } catch (error) {
      failures.push(`projection: ${describeError(error)}`);
    }
  };

  const spawn = (type: string, opts: SpawnWidgetOpts): void => {
    try {
      engine.ops.spawnWidget(type, opts);
      seeded += 1;
    } catch (error) {
      failures.push(`${type}: ${describeError(error)}`);
    }
  };

  project();

  spawn(NOTE_TYPE, {
    x: 120,
    y: 120,
    props: { text: "ICE spike — this note lives in a throwaway document.", seed: 7 },
  });

  const mat = (() => {
    try {
      const entity = engine.ops.spawnWidget(MINIMAT_TYPE, {
        x: 520,
        y: 100,
        props: { name: "Spike container", vinyl: "slate" },
      });
      seeded += 1;
      return entity;
    } catch (error) {
      failures.push(`${MINIMAT_TYPE}: ${describeError(error)}`);
      return undefined;
    }
  })();

  if (mat !== undefined) {
    project();
    spawn(NOTE_TYPE, {
      x: 560,
      y: 140,
      w: 160,
      h: 160,
      parent: mat,
      props: { text: "A note inside the mini mat. Zoom out for the chip LOD." },
    });
  }

  const shape = `${seeded}/${SEED_OBJECT_COUNT} objects seeded`;
  return failures.length === 0 ? shape : `${shape} — ${failures.join("; ")}`;
}

export interface IceSurfaceFallbackProps {
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly sceneHref: string;
}

/** The calm no-desk card. Exported so Storybook can show it without WebGPU. */
export function IceSurfaceFallback({ title, message, detail, sceneHref }: IceSurfaceFallbackProps) {
  return (
    <div className="ice-surface__state" data-testid="ice-fallback">
      <div className="ice-surface__card">
        <p className="ice-surface__card-title" data-testid="ice-fallback-title">
          {title}
        </p>
        <p className="ice-surface__card-copy">{message}</p>
        {detail === undefined ? null : (
          <p className="ice-surface__card-detail" data-testid="ice-fallback-detail">
            {detail}
          </p>
        )}
        <a className="ice-surface__card-link" data-testid="ice-fallback-link" href={sceneHref}>
          Back to the scene surface
        </a>
      </div>
    </div>
  );
}

/** The ICE spike mount. The routing agent renders this only for `?canvas=ice`. */
export function IceSurface() {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const sceneHref = useMemo(sceneSurfaceHref, []);
  const owned = useRef<{ engine?: CanvasEngine; doc?: DocSession }>({});
  // One teardown for both exits: unmount, or a desk that reported `failed`
  // and was replaced by the fallback. Emptying the ref makes it idempotent.
  const teardown = useCallback(() => {
    const { engine, doc } = owned.current;
    owned.current = {};
    if (doc !== undefined) quietly(() => doc.close());
    if (engine !== undefined) quietly(() => engine.dispose());
  }, []);

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

      setPhase({ kind: "loading" });

      let adapter: unknown;
      try {
        adapter = await gpu.requestAdapter();
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
      if (adapter === null || adapter === undefined) {
        setPhase({
          kind: "unavailable",
          reason: "adapter",
          detail: "requestAdapter() returned no adapter.",
        });
        return;
      }

      try {
        const [core, desk, objects, react] = await Promise.all([
          import("@vibecook/ice"),
          import("@vibecook/ice/desk"),
          import("@vibecook/ice/desk/objects"),
          import("@vibecook/ice/react"),
        ]);
        if (cancelled) return;

        const engine = core.createCanvasEngine(objects.DESK_ENGINE);
        const doc = engine.docs.create();
        owned.current = { engine, doc };
        const seed = seedSpikeDocument(engine);
        const layer = desk.deskLayer({
          theme: objects.deskTheme("light"),
          palette: objects.deskPalette("light"),
          objects: [...objects.DESK_OBJECTS],
          docs: engine.docs,
          name: "ice-spike",
        });

        if (cancelled) return;
        setPhase({
          kind: "ready",
          engine,
          layer,
          Desk: react.Desk,
          EngineProvider: react.EngineProvider,
          seed,
        });
      } catch (error) {
        if (!cancelled) setPhase({ kind: "failed", detail: describeError(error) });
      }
    };

    void start();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [teardown]);

  // A desk that reported `failed` is replaced by the fallback, so its engine
  // is released here rather than held until the route changes.
  useEffect(() => {
    if (phase.kind === "failed") teardown();
  }, [phase.kind, teardown]);

  /**
   * The desk reports its own boot and device loss. A `failed` desk is replaced
   * by the fallback (the engine is disposed with it); `degraded` keeps drawing
   * and says so in the HUD.
   */
  const handleReady = useCallback((handle: DeskHandle) => {
    const layer = handle.layer as Partial<DeskLayerHandle>;
    const apply = (status: DeskLayerStatus): void => {
      setEngineState(status.state);
      if (status.state === "failed") {
        setPhase({
          kind: "failed",
          detail: status.message ?? "The desk reported a failed device.",
        });
      }
    };

    if (typeof layer.status === "function") apply(layer.status());
    if (typeof layer.onStatus !== "function") return;
    return layer.onStatus(apply);
  }, []);

  const ready = phase.kind === "ready" ? phase : null;

  return (
    <section
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
            className="ice-surface__desk"
            style={{ position: "absolute", inset: 0 }}
          />
        </ready.EngineProvider>
      )}

      {phase.kind === "checking" ? (
        <IceSurfaceFallback
          title="Checking for WebGPU"
          message="ICE needs WebGPU before it can start. Nothing has been loaded yet."
          sceneHref={sceneHref}
        />
      ) : null}

      {phase.kind === "loading" ? (
        <IceSurfaceFallback
          title="Starting the ICE desk"
          message="Importing the engine and acquiring the GPU. This is a one-time cost; the default canvas never pays it."
          sceneHref={sceneHref}
        />
      ) : null}

      {phase.kind === "unavailable" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "api" ? "This browser has no WebGPU" : "WebGPU has no graphics adapter"
          }
          message="ICE is an experimental WebGPU engine, so the desk cannot start here. The default canvas and the scene projection are unaffected."
          detail={
            phase.reason === "api"
              ? `${phase.detail} Try Chrome 113+, Edge 113+, or Safari 26+ with hardware acceleration on.`
              : `${phase.detail} Check that hardware acceleration is on and a supported GPU is present.`
          }
          sceneHref={sceneHref}
        />
      ) : null}

      {phase.kind === "failed" ? (
        <IceSurfaceFallback
          title="ICE could not start"
          message="The desk failed before it could draw. Nothing was written to your workspace."
          detail={phase.detail}
          sceneHref={sceneHref}
        />
      ) : null}

      <div className="ice-surface__badge" data-testid="ice-hud">
        <span className="ice-surface__badge-title">ICE spike</span>
        <span className="ice-surface__badge-note">Experimental — not document truth</span>
        <span className="ice-surface__badge-status" data-testid="ice-status" aria-live="polite">
          engine: {phase.kind === "ready" ? (engineState ?? "starting") : phase.kind}
        </span>
        {ready === null ? null : (
          <span className="ice-surface__badge-seed" data-testid="ice-seed">
            {ready.seed}
          </span>
        )}
        <span className="ice-surface__badge-hint">
          Pan the mat · wheel to zoom · click a note to select
        </span>
        <a className="ice-surface__link" data-testid="ice-scene-link" href={sceneHref}>
          Back to the scene surface
        </a>
      </div>
    </section>
  );
}

export default IceSurface;
