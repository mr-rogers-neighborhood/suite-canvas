/**
 * The visible face of the two type-graph kinds (`suite.typeNode`,
 * `suite.containerNode`), drawn in screen space.
 *
 * WHY THE DOM HALF, AND NOT THE PAPER'S TEXT PATH — the choice ADR-0036 §5 asks
 * for, made once here:
 *
 * The graph is shown in the far band (zoom ≈ 0.06). A type node's cell is ≤ 96
 * × 64 world units (`typeGraph.ts`), so at that zoom its footprint is a handful
 * of pixels: the paper program's banded text raster would draw a name at 0.4 px
 * and its `greek` asset is deliberately *not* readable (it is a line-and-bar
 * placeholder, `PaperWriting`). Text that must be read at graph zoom can
 * therefore only be text that does not scale with the world, which is CSS
 * pixels — the same call `suitePinKind` makes for a pin's label. The GPU half
 * still exists (the reused paper program) but only as the pick footprint; its
 * presence is held near zero so no sticky sheet shows behind the face
 * (`graphNodeBacking` in each kind).
 *
 * What is constant and what is not:
 * - the GLYPH, the NAME and the COUNT are laid out in CSS pixels and never
 *   scale with the camera — that is what keeps them legible at every zoom;
 * - the PLATE follows the node's projected footprint, clamped to a legible
 *   minimum (and, for a type node, a maximum), because a plate that ignored the
 *   footprint entirely would pile up on its neighbours in a dense cluster.
 *
 * What "a DOM overlay per node" is *not*, here: this is ONE inert layer per
 * kind (an absolutely positioned element and three spans per node, no React, no
 * Tiptap, no document read), the same construction `suitePinKind` uses for pin
 * labels. The expensive thing the editor budget rations — a mounted `NodeCard`
 * twin with an editor lease — is never mounted by a graph kind, and nothing here
 * can take a caret or a keystroke: the layer is `pointer-events:none` and every
 * pick goes to ICE's GPU rect.
 *
 * One deliberate departure from ADR-0036 §5: a *card* at `icon` draws no title,
 * because a truncated "Kn…" implies a title it does not have. A graph node is
 * not a card — its name is not a stub of its content, it *is* its content ("the
 * Concept cluster, 12 cards"), so the node's own three fields are the whole
 * face at every zoom.
 *
 * Depth is the stack from `suiteGraphDepth`: the face is drawn a few pixels
 * up-left of its footprint and slightly small, over one plate per shallower
 * level. The offsets are screen pixels, so the stack reads the same at every
 * zoom; the GPU footprint is never offset, so the rect ICE picks is the rect the
 * node actually occupies.
 *
 * The only ICE import is the `KindLocal` *type* (erased at build): no runtime
 * ICE in this module, so it is pure DOM + math and can be unit-tested in jsdom,
 * and the kinds only feed it props. It never reads the document and never
 * writes one.
 */

import type { KindLocal } from "@vibecook/ice/desk";
import { graphDepthLevel, graphDepthOffset } from "./suiteGraphDepth";

/** The screen-space camera, as ICE's `Camera` resource exposes it. */
export interface SuiteGraphFaceCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A node's footprint in world units — top-left plus size. */
export interface SuiteGraphFaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Which of the two faces a node draws. */
export type SuiteGraphFaceKind = "type" | "container";

/** One plate as the layer paints it: screen box, level and shadow weight. */
export interface SuiteGraphFacePlate {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly level: number;
  /** Shadow weight, `0` at the surface … `1` at the deepest level. */
  readonly shadow: number;
}

/** A node's face and the plates that stack behind it. */
export interface SuiteGraphFacePlacement {
  /** The top plate — the one that carries the glyph, the name and the count. */
  readonly face: SuiteGraphFacePlate;
  /** The plates behind it, painted in order (shallowest last). */
  readonly stack: readonly SuiteGraphFacePlate[];
}

/**
 * The size band a face is drawn in, screen px.
 *
 * A type node is a chip: it may shrink to the width of a short name and no
 * further, and it stops growing once it would read as a card. A container is a
 * frame: it follows its footprint so it actually frames the clusters inside it,
 * with a floor that still fits one chip.
 */
export const SUITE_GRAPH_FACE_BOUNDS = {
  type: { minWidth: 64, minHeight: 34, maxWidth: 168, maxHeight: 76 },
  container: { minWidth: 72, minHeight: 52, maxWidth: 4096, maxHeight: 4096 },
} as const;

/** A card count read back from a prop may be anything after a hand edit. */
export function graphCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.round(count));
}

/** The slice of the reused paper program's geometry the backing rule rewrites. */
export interface SuiteGraphBacking {
  readonly angle: number;
  readonly cos: number;
  readonly sin: number;
  readonly alpha: number;
}

/**
 * The GPU half of a graph node, shared by both kinds: the reused paper program
 * draws the pick footprint, never a sticky. A note is seeded a small tilt and
 * drawn at full presence; a node is square to the desk and its presence is held
 * at `alpha` (near zero), so the sheet, its ink and its shadow stay invisible
 * behind the screen-space face. `hit` is the same program's own SDF, so the
 * node stays pickable on exactly the rect the face is drawn over.
 */
export function graphNodeBacking<G extends SuiteGraphBacking>(geometry: G, alpha: number): G {
  return { ...geometry, angle: 0, cos: 1, sin: 0, alpha: Math.min(geometry.alpha, alpha) };
}

/** A graph kind's per-desk state: the face layer's frame hook. */
export interface SuiteGraphFaceLocal extends KindLocal {
  setSink(sink: (() => void) | undefined): void;
}

/**
 * The kind's own state on one desk. The paper writing keeps its state (the
 * reused `record` reads it); the DOM half's `sync` rides the same tick ICE
 * already runs before each build, so there is no private rAF loop and `due()`
 * stays the paper's — the desk sleeps when nothing moves.
 */
export function createSuiteGraphFaceLocal(base: KindLocal | undefined): SuiteGraphFaceLocal {
  let sink: (() => void) | undefined;
  return {
    ...base,
    setSink: (next) => {
      sink = next;
    },
    tick: (now) => {
      const wants = base?.tick?.(now) ?? false;
      sink?.();
      return wants;
    },
    due: (now) => base?.due?.(now) ?? Number.POSITIVE_INFINITY,
    dispose: () => {
      base?.dispose?.();
      sink = undefined;
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function plateAt(
  centreX: number,
  centreY: number,
  width: number,
  height: number,
  level: number,
): SuiteGraphFacePlate {
  const offset = graphDepthOffset(level);
  const w = width * offset.scale;
  const h = height * offset.scale;
  return {
    left: centreX - w / 2 + offset.dx,
    top: centreY - h / 2 + offset.dy,
    width: w,
    height: h,
    level: offset.level,
    shadow: offset.shadow,
  };
}

/**
 * A node's face for one frame, or `null` when it must not be drawn: unusable
 * geometry or camera. The plate's *size* reads the zoom only through the
 * footprint clamp; its contents never do.
 */
export function suiteGraphFacePlacement(
  rect: SuiteGraphFaceRect | null | undefined,
  camera: SuiteGraphFaceCamera | null | undefined,
  depth: number,
  kind: SuiteGraphFaceKind,
): SuiteGraphFacePlacement | null {
  if (rect === null || rect === undefined) return null;
  if (camera === null || camera === undefined) return null;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  if (![camera.x, camera.y, camera.zoom].every((value) => Number.isFinite(value))) return null;
  if (camera.zoom <= 0) return null;
  const bounds = SUITE_GRAPH_FACE_BOUNDS[kind];
  const zoom = camera.zoom;
  const projectedWidth = Math.abs(width) * zoom;
  const projectedHeight = Math.abs(height) * zoom;
  const faceWidth = clamp(projectedWidth, bounds.minWidth, bounds.maxWidth);
  const faceHeight = clamp(projectedHeight, bounds.minHeight, bounds.maxHeight);
  const centreX = (x + width / 2 - camera.x) * zoom;
  const centreY = (y + height / 2 - camera.y) * zoom;
  const level = graphDepthLevel(depth);
  const stack: SuiteGraphFacePlate[] = [];
  // Shallowest first: each deeper plate is painted over it, so the pile steps
  // down-right and the top plate is the node's own face.
  for (let shallower = 0; shallower < level; shallower += 1) {
    stack.push(plateAt(centreX, centreY, faceWidth, faceHeight, shallower));
  }
  return { face: plateAt(centreX, centreY, faceWidth, faceHeight, level), stack };
}

/** One node as the layer paints it — props only, never a document read. */
export interface SuiteGraphFaceNode {
  /** Stable DOM identity across frames (the entity id, as a string). */
  readonly id: string;
  readonly kind: SuiteGraphFaceKind;
  readonly rect: SuiteGraphFaceRect;
  readonly depth: number;
  readonly label: string;
  /** The type's glyph; empty for a container, whose face carries no icon. */
  readonly glyph: string;
  readonly count: number;
  /** A section swatch name, drawn when it is a plain token and ignored otherwise. */
  readonly color?: string | undefined;
}

export interface SuiteGraphFaceLayerOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  /** Enumerate the kind's live nodes, once per `sync()`. */
  readonly nodes: () => Iterable<SuiteGraphFaceNode>;
  readonly camera: () => SuiteGraphFaceCamera | null | undefined;
  /** The layer's stacking order against the desk's other screen-space halves. */
  readonly zIndex?: number | undefined;
}

export interface SuiteGraphFaceLayerHandle {
  /** The layer root appended to the desk container. */
  readonly layer: HTMLElement;
  /** Place and paint every node from the current camera and geometry. */
  sync(): void;
  /** Nodes currently drawn (visible). */
  visibleCount(): number;
  dispose(): void;
}

interface FaceSlot {
  readonly element: HTMLElement;
  readonly glyph: HTMLElement;
  readonly label: HTMLElement;
  readonly count: HTMLElement;
  /** Plates behind the face, reused up to `GRAPH_DEPTH_MAX`. */
  readonly plates: HTMLElement[];
  kind: SuiteGraphFaceKind;
  visible: boolean;
}

const LAYER_CLASS = "suite-graph-face-layer";
const FACE_CLASS = "suite-graph-face";
const PLATE_CLASS = "suite-graph-face__plate";
const GLYPH_CLASS = "suite-graph-face__glyph";
const LABEL_CLASS = "suite-graph-face__label";
const COUNT_CLASS = "suite-graph-face__count";

/** A swatch name is a CSS token, never arbitrary CSS from a hand-edited prop. */
const SWATCH = /^[a-z][a-z0-9-]{0,23}$/;

function accentOf(color: string | undefined): string {
  if (color === undefined || !SWATCH.test(color)) return "var(--accent, #5b5bd6)";
  return `var(--section-${color}, var(--accent, #5b5bd6))`;
}

function shadowOf(weight: number): string {
  // A deeper plate casts further and darker; `weight` is already 0 … 1.
  const blur = 2 + weight * 10;
  const spread = weight * 2;
  const alpha = 0.12 + weight * 0.18;
  return `0 ${1 + weight * 3}px ${blur}px ${spread}px rgba(0,0,0,${alpha.toFixed(3)})`;
}

/**
 * The screen-space half: one absolutely positioned element per node in a single
 * layer, sized and placed in CSS pixels, so the camera moves the face without
 * ever scaling its text. `sync()` is the one frame hook; the kinds hang it on
 * their `KindLocal.tick`, so the desk still sleeps when nothing moves.
 */
export function createSuiteGraphFaceLayer(
  opts: SuiteGraphFaceLayerOptions,
): SuiteGraphFaceLayerHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = LAYER_CLASS;
  layer.dataset.testid = LAYER_CLASS;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${
    opts.zIndex ?? 2
  };contain:layout style;`;

  const slots = new Map<string, FaceSlot>();

  const ensure = (node: SuiteGraphFaceNode): FaceSlot => {
    const existing = slots.get(node.id);
    if (existing !== undefined && existing.kind === node.kind) return existing;
    if (existing !== undefined) destroy(node.id, existing);
    // The face is its own positioned element and the plates are its siblings,
    // so a plate never inherits the face's text layout.
    const element = doc.createElement("div");
    element.className = FACE_CLASS;
    element.dataset.testid = FACE_CLASS;
    element.style.cssText =
      "position:absolute;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:4px 8px;overflow:hidden;";

    const glyph = doc.createElement("span");
    glyph.className = GLYPH_CLASS;
    glyph.dataset.testid = GLYPH_CLASS;
    glyph.style.cssText =
      "flex:none;font:600 16px/18px ui-sans-serif,system-ui,sans-serif;display:none;";

    const label = doc.createElement("span");
    label.className = LABEL_CLASS;
    label.dataset.testid = LABEL_CLASS;
    label.style.cssText =
      "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px/14px ui-sans-serif,system-ui,sans-serif;";

    const count = doc.createElement("span");
    count.className = COUNT_CLASS;
    count.dataset.testid = COUNT_CLASS;
    count.style.cssText =
      "flex:none;font:600 10px/12px ui-sans-serif,system-ui,sans-serif;padding:1px 5px;border-radius:999px;";

    element.append(glyph, label, count);
    layer.append(element);
    const slot: FaceSlot = {
      element,
      glyph,
      label,
      count,
      plates: [],
      kind: node.kind,
      visible: true,
    };
    slots.set(node.id, slot);
    return slot;
  };

  const destroy = (id: string, slot: FaceSlot): void => {
    slot.element.remove();
    for (const plate of slot.plates) plate.remove();
    slots.delete(id);
  };

  const paint = (
    slot: FaceSlot,
    node: SuiteGraphFaceNode,
    placement: SuiteGraphFacePlacement,
  ): void => {
    const { face, stack } = placement;
    slot.kind = node.kind;
    slot.element.dataset.kind = node.kind;
    slot.element.style.left = `${face.left}px`;
    slot.element.style.top = `${face.top}px`;
    slot.element.style.width = `${face.width}px`;
    slot.element.style.height = `${face.height}px`;
    slot.element.style.zIndex = `${face.level + 1}`;
    slot.element.style.borderRadius = node.kind === "container" ? "12px" : "8px";
    slot.element.style.background =
      node.kind === "container"
        ? "color-mix(in srgb, var(--surface, #fff) 38%, transparent)"
        : "var(--surface, #fff)";
    // The accent rides a custom property so a swatch change repaints the border,
    // the glyph and the badge together without re-parsing a shorthand.
    slot.element.style.setProperty("--suite-graph-accent", accentOf(node.color));
    slot.element.style.border = "1.5px solid var(--suite-graph-accent)";
    slot.element.style.boxShadow = shadowOf(face.shadow);
    const count = graphCount(node.count);
    const noun = count === 1 ? "card" : "cards";
    slot.element.title =
      node.label.length > 0 ? `${node.label} — ${count} ${noun}` : `${count} ${noun}`;
    slot.element.dataset.color = node.color ?? "";

    // A container's frame carries its title inside its top-left and its total
    // top-right, leaving the middle empty for the clusters it holds.
    if (node.kind === "container") {
      slot.element.style.alignItems = "flex-start";
      slot.element.style.padding = "6px 10px";
    }

    slot.glyph.textContent = node.glyph;
    slot.glyph.style.display = node.kind === "type" && node.glyph.length > 0 ? "block" : "none";
    slot.glyph.style.color = "var(--suite-graph-accent)";
    slot.label.textContent = node.label;
    slot.count.textContent = `${count}`;
    slot.count.style.color = "var(--suite-graph-accent)";
    slot.count.style.background = "color-mix(in srgb, currentColor 14%, transparent)";

    // The plates behind it, reusing elements across frames.
    while (slot.plates.length < stack.length) {
      const plate = doc.createElement("div");
      plate.className = PLATE_CLASS;
      plate.dataset.testid = PLATE_CLASS;
      plate.style.cssText =
        "position:absolute;box-sizing:border-box;pointer-events:none;border-radius:8px;background:var(--surface, #fff);";
      layer.append(plate);
      slot.plates.push(plate);
    }
    slot.plates.forEach((plate, index) => {
      const step = stack[index];
      if (step === undefined) {
        plate.style.display = "none";
        return;
      }
      plate.style.display = "block";
      plate.style.left = `${step.left}px`;
      plate.style.top = `${step.top}px`;
      plate.style.width = `${step.width}px`;
      plate.style.height = `${step.height}px`;
      plate.style.zIndex = `${step.level + 1}`;
      plate.style.opacity = `${0.45 + step.level * 0.08}`;
      plate.style.setProperty("--suite-graph-accent", accentOf(node.color));
      plate.style.border = "1px solid var(--suite-graph-accent)";
      plate.style.boxShadow = shadowOf(step.shadow);
    });

    slot.element.style.display = "flex";
    slot.visible = true;
  };

  const sync = (): void => {
    const camera = opts.camera();
    const seen = new Set<string>();
    for (const node of opts.nodes()) {
      seen.add(node.id);
      const slot = ensure(node);
      const placement = suiteGraphFacePlacement(node.rect, camera, node.depth, node.kind);
      if (placement === null) {
        slot.element.style.display = "none";
        slot.visible = false;
        for (const plate of slot.plates) plate.style.display = "none";
        continue;
      }
      paint(slot, node, placement);
    }
    for (const [id, slot] of slots) {
      if (!seen.has(id)) destroy(id, slot);
    }
  };

  opts.container.append(layer);

  return {
    layer,
    sync,
    visibleCount: () => {
      let count = 0;
      for (const slot of slots.values()) if (slot.visible) count += 1;
      return count;
    },
    dispose: () => {
      for (const [id, slot] of slots) destroy(id, slot);
      layer.remove();
    },
  };
}
