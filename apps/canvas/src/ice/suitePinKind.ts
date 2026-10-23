/**
 * `suite.pin` — a spatial bookmark's marker on the ICE desk (ADR-0035).
 *
 * Two halves, exactly like `suite.card`:
 *
 * GPU backing: the built-in paper program (`paperKind()`), reused under this
 * kind's own name. There is no marker program in `@vibecook/ice/desk/objects`
 * (the six reference kinds are note, mini mat, whiteboard, calendar, notebook
 * and photo), so the note's program is the smallest one that draws a small,
 * square, pickable body. It is *only* the pick footprint here: `resolve` pins
 * the reused sheet's presence near zero, so no yellow sticky shows behind the
 * marker, while `hit` (the program's own SDF) still answers a press.
 *
 * DOM half: `host.mount` appends a screen-space layer and registers its `sync`
 * on the kind's `KindLocal.tick` — the frame hook ICE already ticks before each
 * build, with `due() === Infinity` so the desk may sleep when nothing moves.
 * Each marker is a dot plus a short label laid out in CSS pixels and positioned
 * from `geometryOf(entity)` and the camera; it is never scaled by the world, so
 * it stays the same size at every zoom. Below `SUITE_PIN_LABEL_MIN_ZOOM` the
 * label is hidden and the dot alone marks the place; the dot is never hidden.
 *
 * No writes and no document access: the props `pinId`/`boardId`/`label`/`color`
 * are display-only, and every move of a pin is a `WorkspaceDocument` write the
 * canvas makes on release. Known gap, shared with `suite.card`: the DOM layer is
 * `pointer-events:none`, so picking uses the GPU rect, which shrinks with the
 * world while the dot does not — a very far marker is easy to see and hard to
 * press until a chip/impostor rung owns that band.
 */

import { type PinColor, pinColors } from "@suite/graph";
import {
  Camera,
  type Component,
  defineQuery,
  type Entity,
  PrefabId,
  p,
  type World,
} from "@vibecook/ice";
import { DESK_OBJECT, defineObject, type KindDriver, type KindLocal } from "@vibecook/ice/desk";
import { PENS, paperKind } from "@vibecook/ice/desk/objects";

/** The object type and its kind share the name; both are unique on this desk. */
export const SUITE_PIN_TYPE = "suite.pin";
export const SUITE_PIN_KIND = "suite.pin";

/**
 * The marker's screen size, CSS px — the same at every zoom. The world footprint
 * is this size too, so at 100% the pick rect and the dot coincide.
 */
export const SUITE_PIN_MARKER_PX = 20;

/** The pin's world footprint — what ICE picks and drags. */
export const SUITE_PIN_SIZE = { w: SUITE_PIN_MARKER_PX, h: SUITE_PIN_MARKER_PX } as const;

/** Below this camera zoom the label would not be readable, so only the dot shows. */
export const SUITE_PIN_LABEL_MIN_ZOOM = 0.6;

/**
 * The reused sheet is a footprint, not paper: its presence is held this close to
 * zero so the note's sheet, ink and shadow stay invisible behind the dot.
 */
export const SUITE_PIN_BACKING_ALPHA = 0.02;

/** Every widget carries `PrefabId`; the overlay filters it by our type id. */
const WIDGETS = defineQuery([PrefabId]);

/** The screen-space camera, as ICE's `Camera` resource exposes it. */
export interface SuitePinCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The slice of the kind's geometry the marker reads (`PaperGeometry` satisfies it). */
export interface SuitePinGeometry {
  /** World centre of the pin — where the marker points. */
  readonly centre: readonly [number, number];
  /** Presence, 1 at rest; 0 gone. Absent means 1. */
  readonly alpha?: number;
}

/** What the kind carries about the pin, as `infoOf` reports it (`faceOf` in the kind). */
export interface SuitePinFace {
  readonly pinId: string;
  readonly boardId: string;
  readonly label: string;
  readonly color: string;
}

/** One marker's screen-space placement, colour and label state. */
export interface SuitePinMarker {
  /** Screen-space top-left of the marker, CSS px of the desk container. */
  readonly left: number;
  readonly top: number;
  /** The marker's screen size, CSS px — constant at every zoom. */
  readonly size: number;
  /** Whether the label is readable at this zoom (the dot is always drawn). */
  readonly showLabel: boolean;
  readonly label: string;
  readonly color: PinColor;
}

export interface SuitePinMarkerOptions {
  readonly markerSize?: number;
  readonly labelMinZoom?: number;
}

const PIN_COLORS = new Set<string>(pinColors);

/** A colour read back from a prop may be anything after a hand edit; slate is the safe swatch. */
function pinColorOf(value: string | undefined): PinColor {
  return value !== undefined && PIN_COLORS.has(value) ? (value as PinColor) : "slate";
}

/**
 * The marker for one frame, or `null` when it must not be drawn: missing or
 * non-finite geometry, a non-positive camera zoom, or a faded-out pin. The
 * marker's size never reads the zoom — position follows the camera, size does
 * not, which is what keeps it readable at every LOD.
 */
export function suitePinMarker(
  geometry: SuitePinGeometry | null | undefined,
  camera: SuitePinCamera | null | undefined,
  face?: SuitePinFace | undefined,
  options: SuitePinMarkerOptions = {},
): SuitePinMarker | null {
  if (geometry === null || geometry === undefined) return null;
  if (camera === null || camera === undefined) return null;
  const [cx, cy] = geometry.centre;
  const zoom = camera.zoom;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return null;
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  if ((geometry.alpha ?? 1) <= 0.01) return null;
  const size = options.markerSize ?? SUITE_PIN_MARKER_PX;
  const labelMinZoom = options.labelMinZoom ?? SUITE_PIN_LABEL_MIN_ZOOM;
  const label = face?.label ?? "";
  return {
    left: (cx - camera.x) * zoom - size / 2,
    top: (cy - camera.y) * zoom - size / 2,
    size,
    // A viewer reads a label at nearby zoom; a pin has one (the schema requires
    // it), so an empty string is a projection gap and draws no bubble.
    showLabel: zoom >= labelMinZoom && label.length > 0,
    label,
    color: pinColorOf(face?.color),
  };
}

export interface SuitePinOverlayOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  /** Enumerate the kind's live entities, once per `sync()`. */
  readonly entities: () => Iterable<number>;
  readonly geometryOf: (entity: number) => SuitePinGeometry | null | undefined;
  readonly camera: () => SuitePinCamera | null | undefined;
  readonly infoOf?: (entity: number) => SuitePinFace | undefined;
  readonly markerSize?: number | undefined;
  readonly labelMinZoom?: number | undefined;
}

export interface SuitePinOverlayHandle {
  /** The overlay root appended to the desk container. */
  readonly layer: HTMLElement;
  /** Position every marker from the current camera and geometry, and style it. */
  sync(): void;
  /** Markers currently drawn (visible). */
  visibleCount(): number;
  dispose(): void;
}

interface MarkerSlot {
  readonly element: HTMLElement;
  readonly dot: HTMLElement;
  readonly label: HTMLElement;
}

const MARKER_CLASS = "suite-pin-overlay__marker";
const DOT_CLASS = "suite-pin-overlay__dot";
const LABEL_CLASS = "suite-pin-overlay__label";

/**
 * The screen-space half. A plain DOM layer (no React, no Loro): one absolutely
 * positioned marker per pin, each sized in CSS pixels, so the camera moves it
 * without ever scaling it. `sync()` is the one frame hook.
 */
export function createSuitePinOverlay(opts: SuitePinOverlayOptions): SuitePinOverlayHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = "suite-pin-overlay";
  layer.dataset.testid = "suite-pin-overlay";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3;contain:layout style;";

  const slots = new Map<number, MarkerSlot>();

  const ensure = (entity: number): MarkerSlot => {
    const existing = slots.get(entity);
    if (existing !== undefined) return existing;
    const element = doc.createElement("div");
    element.className = MARKER_CLASS;
    element.dataset.entity = String(entity);
    element.style.cssText = "position:absolute;left:0;top:0;display:none;pointer-events:none;";
    const dot = doc.createElement("span");
    dot.className = DOT_CLASS;
    dot.style.cssText =
      "position:absolute;inset:0;border-radius:999px;border:1.5px solid rgba(255,255,255,0.92);box-shadow:0 1px 3px rgba(0,0,0,0.35);";
    const label = doc.createElement("span");
    label.className = LABEL_CLASS;
    label.style.cssText =
      "position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:3px;padding:1px 5px;border-radius:6px;background:var(--surface,#fff);color:var(--ink,#1f2328);font:600 10px/14px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.25);display:none;";
    element.append(dot, label);
    layer.append(element);
    const slot: MarkerSlot = { element, dot, label };
    slots.set(entity, slot);
    return slot;
  };

  const destroy = (entity: number, slot: MarkerSlot): void => {
    slot.element.remove();
    slots.delete(entity);
  };

  const sync = (): void => {
    const camera = opts.camera();
    const seen = new Set<number>();
    for (const entity of opts.entities()) {
      seen.add(entity);
      const slot = ensure(entity);
      const marker = suitePinMarker(opts.geometryOf(entity), camera, opts.infoOf?.(entity), {
        ...(opts.markerSize === undefined ? {} : { markerSize: opts.markerSize }),
        ...(opts.labelMinZoom === undefined ? {} : { labelMinZoom: opts.labelMinZoom }),
      });
      if (marker === null) {
        slot.element.style.display = "none";
        slot.element.dataset.visible = "false";
        continue;
      }
      slot.element.style.display = "block";
      slot.element.dataset.visible = "true";
      slot.element.dataset.color = marker.color;
      slot.element.style.left = `${marker.left}px`;
      slot.element.style.top = `${marker.top}px`;
      slot.element.style.width = `${marker.size}px`;
      slot.element.style.height = `${marker.size}px`;
      slot.dot.style.background = `var(--section-${marker.color})`;
      slot.label.textContent = marker.label;
      slot.label.style.display = marker.showLabel ? "block" : "none";
      slot.label.dataset.visible = marker.showLabel ? "true" : "false";
    }
    for (const [entity, slot] of slots) {
      if (!seen.has(entity)) destroy(entity, slot);
    }
  };

  opts.container.append(layer);

  return {
    layer,
    sync,
    visibleCount: () => {
      let count = 0;
      for (const slot of slots.values()) if (slot.element.dataset.visible === "true") count += 1;
      return count;
    },
    dispose: () => {
      for (const [entity, slot] of slots) destroy(entity, slot);
      layer.remove();
    },
  };
}

/** Our kind's per-desk state: the overlay's frame hook. */
interface SuitePinLocal extends KindLocal {
  setSink(sink: (() => void) | undefined): void;
}

function createSuitePinLocal(base: KindLocal | undefined): SuitePinLocal {
  let sink: (() => void) | undefined;
  return {
    // Keep the paper writing's own state (the reused `record` reads it).
    ...base,
    setSink: (next) => {
      sink = next;
    },
    tick: (now) => {
      // The GPU record's motion is still the paper writing's; the DOM sync is
      // ours and happens on the same tick, before the build.
      const wants = base?.tick?.(now) ?? false;
      sink?.();
      return wants;
    },
    // Our overlay has no time wakes of its own; the paper writing's stand.
    due: (now) => base?.due?.(now) ?? Number.POSITIVE_INFINITY,
    dispose: () => {
      base?.dispose?.();
      sink = undefined;
    },
  };
}

/** What the DOM half needs of the kind's driver: a place to hang the overlay's sync. */
interface SuitePinDriver extends KindDriver {
  attach(overlay: SuitePinOverlayHandle): void;
}

const paper = paperKind();

/** The reused paper program's geometry (the type is not re-exported by the objects package). */
type PaperKindOf = ReturnType<typeof paperKind>;

const suitePinKind: PaperKindOf = {
  ...paper,
  name: SUITE_PIN_KIND,
  resolve(ctx) {
    const geometry = paper.resolve(ctx);
    // A marker is square to the desk and never reads as a lifted sticky: drop
    // the note's seeded tilt and hold its presence near zero. `hit` is the
    // program's own SDF on the same geometry, so the pin stays pickable.
    return {
      ...geometry,
      angle: 0,
      cos: 1,
      sin: 0,
      alpha: Math.min(geometry.alpha, SUITE_PIN_BACKING_ALPHA),
    };
  },
  local: (host) => createSuitePinLocal(paper.local?.(host)),
};

export const SuitePin = defineObject({
  type: SUITE_PIN_TYPE,
  version: 1,
  props: {
    // The workspace pin this object stands for; the canvas writes its moves.
    pinId: p.string({ default: "" }),
    // The board the marker sits on; a pin is drawn on no other board.
    boardId: p.string({ default: "" }),
    label: p.string({ default: "" }),
    // The marker colour, as a section swatch name (`pinColors`).
    color: p.enum(pinColors, { default: "amber" }),
    // Read by the reused paper kind for its (invisible) sheet and ink.
    paper: p.enum(["yellow"] as const, { default: "yellow" }),
    pen: p.enum(PENS, { default: "fountain" }),
    seed: p.number({ default: 0 }),
  },
  groups: { pin: ["pinId", "boardId", "label", "color"] },
  size: SUITE_PIN_SIZE,
  kind: suitePinKind,
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
  provides: [DESK_OBJECT],
  drivers: (host) => {
    const local = host.local as SuitePinLocal | undefined;
    let attached: SuitePinOverlayHandle | undefined;
    const driver: SuitePinDriver = {
      follow: () => {},
      idle: () => true,
      attach: (overlay) => {
        attached = overlay;
        local?.setSink(overlay.sync);
        overlay.sync();
      },
      dispose: () => {
        local?.setSink(undefined);
        attached?.dispose();
        attached = undefined;
      },
    };
    return driver;
  },
  host: {
    mount: (host) => {
      const overlay = createSuitePinOverlay({
        container: host.container,
        entities: () => suitePinEntities(host.world).map((entity) => entity as unknown as number),
        geometryOf: (entity) => host.geometryOf(entity as Entity) as SuitePinGeometry | undefined,
        camera: () => host.world.getResource(Camera),
        infoOf: (entity) => faceOf(host.world, entity as Entity),
      });
      overlay.sync();
      (host.driver as SuitePinDriver | undefined)?.attach(overlay);
    },
  },
});

/** The `pin` group's component — label/colour read without a second registry. */
export const SUITE_PIN_FACE = groupOf("pin") as Component<SuitePinFace>;

function groupOf(name: string): Component {
  const group = SuitePin.groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.pin: no "${name}" group`);
  return group.component;
}

function suitePinEntities(world: World): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === SUITE_PIN_TYPE;
  });
}

function faceOf(world: World, entity: Entity): SuitePinFace | undefined {
  if (!world.isAlive(entity) || !world.has(entity, SUITE_PIN_FACE)) return undefined;
  const face = world.read(entity, SUITE_PIN_FACE);
  return { pinId: face.pinId, boardId: face.boardId, label: face.label, color: face.color };
}
