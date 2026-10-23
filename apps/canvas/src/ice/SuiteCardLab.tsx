/**
 * The `suite.card` feasibility lab — a throwaway ICE desk with one custom object
 * kind whose screen-space half renders the real Suite `NodeCard`.
 *
 * Not a route, not production. Open `/src/ice/suite-card-lab.html` in a WebGPU browser
 * started with `--enable-unsafe-webgpu` (see `node scripts/ice-chrome.mjs` for
 * the flags). Nothing here reads or writes the workspace.
 */

import {
  acquireCompositorDevice,
  Camera,
  type CanvasEngine,
  createCanvasEngine,
  type DocSession,
  type EngineGpu,
  type Entity,
  Viewport,
  writeRuntimeResource,
} from "@vibecook/ice";
import { type DeskLayerFactory, deskLayer } from "@vibecook/ice/desk";
import { DESK_ENGINE, DESK_OBJECTS, deskPalette, deskTheme } from "@vibecook/ice/desk/objects";
import { Desk, EngineProvider } from "@vibecook/ice/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SUITE_CARD_SIZE,
  SUITE_CARD_TYPE,
  SuiteCard,
  setSuiteCardSlotRenderer,
} from "./suiteCardKind";
import { createNodeCardSlotRenderer } from "./suiteCardNodeCard";

// The kind reads this when the desk builds its DOM halves, which happens after
// the engine/layer exist — so registering once at module load is early enough.
setSuiteCardSlotRenderer(createNodeCardSlotRenderer());

const NOTE_TYPE = "desk.note";

interface LabReady {
  readonly engine: CanvasEngine;
  readonly doc: DocSession;
  readonly gpu: EngineGpu;
  readonly layer: DeskLayerFactory;
  readonly card: Entity;
}

type LabPhase =
  | { readonly kind: "booting" }
  | { readonly kind: "ready"; readonly ready: LabReady }
  | { readonly kind: "unavailable"; readonly message: string };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function seedDesk(engine: CanvasEngine): { card: Entity; note: Entity | undefined } {
  // A document's root frame must be projected before a spawn can be placed.
  engine.step(performance.now());

  const card = engine.ops.spawnWidget(SUITE_CARD_TYPE, {
    x: 120,
    y: 120,
    undoable: false,
    props: {
      title: "A real Suite card on an ICE desk",
      body: "The GPU draws the paper. This face is a screen-space DOM half on the suite.card kind, positioned from geometryOf() every frame. Zoom out and it unmounts; ICE's own selection brackets still target the GPU rect.",
    },
  });

  // One built-in object beside it, to show the custom kind shares the desk,
  // the paper pass and the palette.
  let note: Entity | undefined;
  try {
    note = engine.ops.spawnWidget(NOTE_TYPE, {
      x: 500,
      y: 140,
      undoable: false,
      props: {
        text: "A built-in desk.note — the GPU paper kind suite.card reuses.",
        pen: "ball",
        seed: 9,
      },
    });
  } catch {
    note = undefined;
  }

  engine.step(performance.now());
  return { card, note };
}

/** The lab card's centre in world units: spawn (120, 120) + size/2. */
const CARD_CENTRE = { x: 120 + SUITE_CARD_SIZE.w / 2, y: 120 + SUITE_CARD_SIZE.h / 2 };

/** Put the card near the middle of the viewport at `zoom` (smoke tests steer this). */
function focusCard(engine: CanvasEngine, zoom = 1): void {
  const viewport = engine.world.getResource(Viewport);
  const width = viewport?.w ?? 0;
  const height = viewport?.h ?? 0;
  if (width <= 0 || height <= 0) return;
  writeRuntimeResource(engine.world, Camera, {
    x: CARD_CENTRE.x - width / (2 * zoom),
    y: CARD_CENTRE.y - height / (2 * zoom),
    zoom,
    gesturing: false,
  });
}

/** Lab-only smoke handle; never part of a route. */
interface SuiteCardLabDebug {
  readonly engine: CanvasEngine;
  readonly card: Entity;
  focusCard(zoom?: number): void;
  overlaySlots(): number;
}

declare global {
  interface Window {
    __suiteCardLab?: SuiteCardLabDebug | undefined;
  }
}

export function SuiteCardLab() {
  const [phase, setPhase] = useState<LabPhase>({ kind: "booting" });
  const owned = useRef<Partial<LabReady>>({});

  const teardown = useCallback(() => {
    const { engine, doc, gpu } = owned.current;
    owned.current = {};
    try {
      doc?.close();
    } catch {
      // best effort
    }
    try {
      engine?.dispose();
    } catch {
      // best effort
    }
    try {
      gpu?.destroy();
    } catch {
      // best effort
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const webgpu =
        typeof navigator === "undefined"
          ? undefined
          : (navigator as Navigator & { readonly gpu?: unknown }).gpu;
      if (webgpu == null) {
        setPhase({
          kind: "unavailable",
          message: "navigator.gpu is undefined — open this in WebGPU Chrome.",
        });
        return;
      }
      try {
        const gpu = await acquireCompositorDevice();
        if (cancelled) {
          gpu.destroy();
          return;
        }
        const engine = createCanvasEngine({
          ...DESK_ENGINE,
          widgets: [...DESK_OBJECTS, SuiteCard],
          compositorDevice: gpu,
        });
        const doc = engine.docs.create();
        const { card } = seedDesk(engine);
        const layer = deskLayer({
          theme: deskTheme("light"),
          palette: deskPalette("light"),
          objects: [...DESK_OBJECTS, SuiteCard],
          docs: engine.docs,
          name: "suite-card-lab",
        });
        owned.current = { engine, doc, gpu, layer, card };
        window.__suiteCardLab = {
          engine,
          card,
          focusCard: (zoom = 1) => focusCard(engine, zoom),
          overlaySlots: () =>
            document.querySelectorAll('.suite-card-overlay__slot[data-visible="true"]').length,
        };
        setPhase({ kind: "ready", ready: { engine, doc, gpu, layer, card } });
      } catch (error) {
        if (!cancelled) setPhase({ kind: "unavailable", message: describe(error) });
      }
    };

    void start();
    return () => {
      cancelled = true;
      window.__suiteCardLab = undefined;
      teardown();
    };
  }, [teardown]);

  const ready = phase.kind === "ready" ? phase.ready : null;

  return (
    <main className="suite-card-lab" data-testid="suite-card-lab" data-phase={phase.kind}>
      {ready === null ? null : (
        <EngineProvider engine={ready.engine}>
          <Desk
            engine={ready.engine}
            layer={ready.layer}
            className="suite-card-lab__desk"
            style={{ position: "absolute", inset: 0 }}
            onReady={() => {
              // One frame for the host's viewport sync, then frame the card.
              requestAnimationFrame(() => focusCard(ready.engine));
            }}
          />
        </EngineProvider>
      )}

      <aside className="suite-card-lab__hud" data-testid="suite-card-lab-hud">
        <span className="suite-card-lab__eyebrow">ICE lab · suite.card</span>
        <strong className="suite-card-lab__title">
          {phase.kind === "booting" ? "Booting the desk…" : null}
          {phase.kind === "ready" ? "One card · screen-space DOM half" : null}
          {phase.kind === "unavailable" ? "The desk did not start" : null}
        </strong>
        {phase.kind === "unavailable" ? (
          <code className="suite-card-lab__error" data-testid="suite-card-lab-error">
            {phase.message}
          </code>
        ) : null}
        {ready === null ? null : (
          <span className="suite-card-lab__note">
            Custom kind <code>suite.card</code> over the built-in <code>paper</code> pass. The card
            face is the real
            <code> NodeCard</code> in a DOM overlay; nothing is written to a workspace.
          </span>
        )}
      </aside>
    </main>
  );
}
