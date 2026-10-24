/**
 * A link's description, drawn on screen over the desk.
 *
 * WHY THE DOM IS RIGHT HERE — the desk draws text with the paper ink raster: a
 * kind that writes carries `paperKind().local`, a sheet, a raster band and a
 * page in the ink atlas. `suite.edge` is deliberately none of those things (its
 * record zeroes the sheet's fibre, curl and shadow and lays one capsule per
 * segment), and a description is not paper lying on a line.
 *
 * More to the point, a description has to be *read* at any zoom. The desk's
 * writing scales with the world, so a link's label would be a smudge exactly
 * when the reader is looking at the whole plane — which is when a labelled link
 * earns its label. This repo already made that call once: a Board's name is a
 * screen-space DOM face for the same reason (`suiteBoardFace.ts`), and the flow
 * surface counter-scaled its edge chip for the same reason. So the label is CSS
 * pixels positioned from world coordinates, and the GPU keeps the ink.
 *
 * The layer is inert (`pointer-events:none`) like the connector layer: presses
 * stay with ICE and with the surface's own pick, so a chip can never swallow a
 * click meant for the line under it. Editing is the line's gesture (double
 * click) or the shared menu's row, never a click on the chip.
 *
 * Plain DOM, no React and no ICE: the caller hands it a camera and the anchors
 * it wants drawn, and it lays out one chip per label. The geometry it is given
 * is already projected into the two facts a label needs (where, and what it
 * says), so this module has nothing to decide.
 */

import type { Point } from "@suite/scene";
import type { SuiteCardCamera } from "./suiteCardOverlay";

/** One label to draw: which link it belongs to, its text, and where it sits. */
export interface SuiteEdgeLabelAnchor {
  readonly edgeId: string;
  readonly label: string;
  /** The point the chip is centred on, in the world units the surface projects. */
  readonly point: Point;
}

export interface SuiteEdgeLabelLayerOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  readonly camera: () => SuiteCardCamera | null | undefined;
  /** The labels to draw this tick; an empty list draws nothing. */
  readonly labels: () => readonly SuiteEdgeLabelAnchor[];
  readonly zIndex?: number | undefined;
}

export interface SuiteEdgeLabelLayerHandle {
  readonly layer: HTMLElement;
  sync(): void;
  /** How many chips are on screen — what a test asserts against. */
  count(): number;
  dispose(): void;
}

const TESTID = "suite-edge-label-layer";
/** A description's own cap: the longest label a link can carry without covering it. */
export const SUITE_EDGE_LABEL_MAX_PX = 200;

/**
 * The event that asks for a link's description to be opened. The surface's
 * gesture dispatches it on the canvas when the reader double-clicks the ink; the
 * menu row that offers the same edit calls the same handler directly. One path,
 * one editor, and the editor itself stays in the component that owns it.
 */
export const SUITE_EDGE_LABEL_EVENT = "suite:edit-edge-label";

/** Where to open the inline editor: the link, and the client point asked from. */
export interface SuiteEdgeLabelRequest {
  readonly edgeId: string;
  readonly x: number;
  readonly y: number;
}

/** The request an event carries, or null when it is not one (or is malformed). */
export function edgeLabelRequestOf(event: Event): SuiteEdgeLabelRequest | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const { edgeId, x, y } = detail as {
    readonly edgeId?: unknown;
    readonly x?: unknown;
    readonly y?: unknown;
  };
  if (typeof edgeId !== "string" || edgeId.length === 0) return null;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  return { edgeId, x, y };
}

function project(point: Point, camera: SuiteCardCamera | null | undefined): Point | null {
  if (camera === null || camera === undefined) return null;
  if (![camera.x, camera.y, camera.zoom].every((value) => Number.isFinite(value))) return null;
  if (camera.zoom <= 0) return null;
  if (![point.x, point.y].every((value) => Number.isFinite(value))) return null;
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

export function createSuiteEdgeLabelLayer(
  opts: SuiteEdgeLabelLayerOptions,
): SuiteEdgeLabelLayerHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.dataset.testid = TESTID;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${
    opts.zIndex ?? 6
  };contain:layout style;`;

  const chips = new Map<string, HTMLElement>();

  const sync = (): void => {
    const camera = opts.camera();
    const seen = new Set<string>();
    for (const anchor of opts.labels()) {
      const text = anchor.label.trim();
      // An undescribed link has nothing to draw; the path still carries the
      // hover and the pick, and the menu can add a description to it.
      if (text.length === 0) continue;
      const screen = project(anchor.point, camera);
      if (screen === null) continue;
      seen.add(anchor.edgeId);
      let chip = chips.get(anchor.edgeId);
      if (chip === undefined) {
        chip = doc.createElement("div");
        chip.className = "suite-edge-label";
        chip.dataset.testid = "suite-edge-label";
        chip.dataset.edgeId = anchor.edgeId;
        // Screen pixels, never the world's: a label is text, and text that
        // scales with the camera stops being readable exactly when it matters.
        chip.style.cssText = `position:absolute;transform:translate(-50%,-50%);max-width:${SUITE_EDGE_LABEL_MAX_PX}px;padding:1px 6px;border:1px solid var(--hairline, rgb(0 0 0 / 0.12));border-radius:4px;background:var(--surface, #ffffff);color:var(--ink-muted, #64748b);font:500 11px/16px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 2px rgb(0 0 0 / 0.08);`;
        layer.append(chip);
        chips.set(anchor.edgeId, chip);
      }
      if (chip.textContent !== text) chip.textContent = text;
      chip.style.left = `${screen.x}px`;
      chip.style.top = `${screen.y}px`;
    }
    for (const [edgeId, chip] of [...chips]) {
      if (seen.has(edgeId)) continue;
      chip.remove();
      chips.delete(edgeId);
    }
  };

  return {
    layer,
    sync,
    count: () => chips.size,
    dispose() {
      chips.clear();
      layer.remove();
    },
  };
}
