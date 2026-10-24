/**
 * The two things a link drag needs on screen: the connectors it may leave from,
 * and the line telling you where it is going.
 *
 * Plain DOM, no React and no ICE, like the other surface layers. It draws in
 * CSS pixels from the world anchors the caller hands it, so the same anchors the
 * gesture hit-tests are the ones the pointer sees — a connector that cannot be
 * grabbed is never shown.
 *
 * The layer is inert (`pointer-events:none`): presses stay with ICE and with the
 * surface's own hotspot test, which is what keeps a link drag from competing
 * with a card move.
 */

import type { Point } from "@suite/scene";
import type { ConnectorAnchor } from "./iceLinkDrag";
import type { SuiteCardCamera } from "./suiteCardOverlay";

export interface SuiteConnectorDragView {
  /** The source anchor, world units. */
  readonly from: Point;
  /** The free end, world units. */
  readonly pointer: Point;
  /** The anchor the drop would snap to, world units; null when free. */
  readonly target: Point | null;
}

export interface SuiteConnectorLayerOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  readonly camera: () => SuiteCardCamera | null | undefined;
  /** The connectors to offer — the hovered or selected card's, in world units. */
  readonly anchors: () => readonly ConnectorAnchor[];
  /** The live drag, or null when no link is being drawn. */
  readonly drag?: (() => SuiteConnectorDragView | null) | undefined;
  readonly zIndex?: number | undefined;
}

export interface SuiteConnectorLayerHandle {
  readonly layer: HTMLElement;
  sync(): void;
  visibleCount(): number;
  dispose(): void;
}

const TESTID = "suite-connector-layer";
const SVG_NS = "http://www.w3.org/2000/svg";
const DOT_CLASS = "suite-connector-dot";
const DOT_SIZE = 7;

function project(point: Point, camera: SuiteCardCamera | null | undefined): Point | null {
  if (camera === null || camera === undefined) return null;
  if (![camera.x, camera.y, camera.zoom].every((value) => Number.isFinite(value))) return null;
  if (camera.zoom <= 0) return null;
  if (![point.x, point.y].every((value) => Number.isFinite(value))) return null;
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

export function createSuiteConnectorLayer(
  opts: SuiteConnectorLayerOptions,
): SuiteConnectorLayerHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.dataset.testid = TESTID;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${
    opts.zIndex ?? 7
  };contain:layout style;`;

  const lines = doc.createElementNS(SVG_NS, "svg");
  lines.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;";
  layer.append(lines);

  const dots = new Map<string, HTMLElement>();
  const line = doc.createElementNS(SVG_NS, "line");
  line.dataset.testid = "suite-connector-drag";
  line.setAttribute("stroke", "var(--ink-muted, #64748b)");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-dasharray", "5 4");
  line.setAttribute("stroke-linecap", "round");
  lines.append(line);

  const halo = doc.createElementNS(SVG_NS, "circle");
  halo.dataset.testid = "suite-connector-target";
  halo.setAttribute("r", "7");
  halo.setAttribute("fill", "var(--surface, #ffffff)");
  halo.setAttribute("stroke", "var(--ink-muted, #64748b)");
  halo.setAttribute("stroke-width", "1.5");
  lines.append(halo);

  let count = 0;

  const sync = (): void => {
    const camera = opts.camera();
    const anchors = opts.anchors();
    const seen = new Set<string>();
    for (const anchor of anchors) {
      const screen = project(anchor.point, camera);
      if (screen === null) continue;
      seen.add(anchor.connectorId);
      let dot = dots.get(anchor.connectorId);
      if (dot === undefined) {
        dot = doc.createElement("div");
        dot.className = DOT_CLASS;
        dot.dataset.testid = "suite-connector-dot";
        dot.style.cssText = `position:absolute;width:${DOT_SIZE}px;height:${DOT_SIZE}px;margin:${-DOT_SIZE / 2}px 0 0 ${-DOT_SIZE / 2}px;border-radius:50%;background:var(--surface, #ffffff);border:1px solid var(--ink-muted, #64748b);box-shadow:0 1px 2px rgb(0 0 0 / 0.2);`;
        layer.append(dot);
        dots.set(anchor.connectorId, dot);
      }
      dot.style.left = `${screen.x}px`;
      dot.style.top = `${screen.y}px`;
    }
    for (const [id, dot] of [...dots]) {
      if (seen.has(id)) continue;
      dot.remove();
      dots.delete(id);
    }

    const drag = opts.drag?.() ?? null;
    const from = drag === null ? null : project(drag.from, camera);
    const to = drag === null ? null : project(drag.pointer, camera);
    const target = drag === null || drag.target === null ? null : project(drag.target, camera);
    if (from !== null && to !== null) {
      line.style.display = "block";
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(target?.x ?? to.x));
      line.setAttribute("y2", String(target?.y ?? to.y));
    } else {
      line.style.display = "none";
    }
    halo.style.display = target === null ? "none" : "block";
    if (target !== null) {
      halo.setAttribute("cx", String(target.x));
      halo.setAttribute("cy", String(target.y));
    }

    count = dots.size + (from !== null && to !== null ? 1 : 0) + (target === null ? 0 : 1);
  };

  sync();

  return {
    layer,
    sync,
    visibleCount: () => count,
    dispose() {
      layer.remove();
      dots.clear();
      count = 0;
    },
  };
}
