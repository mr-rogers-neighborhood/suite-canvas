/**
 * The screen-space half of the `suite.card` lab kind (ICE `defineObject({ host })`).
 *
 * ICE draws a card's GPU body from a `KindProgram`; this module owns the DOM
 * overlay that sits exactly over the geometry that program drew. It is
 * deliberately free of ICE imports so the positioning and hide rules can be
 * unit-tested in jsdom without a WebGPU device.
 *
 * Contract with the kind:
 * - `geometryOf(entity)` returns the kind's resolved geometry (`PaperGeometry`
 *   in the lab): a centred rect, its half extents *as drawn*, and its angle.
 * - `camera()` returns the ICE `Camera` resource; ICE's screen mapping is
 *   `screen = (world - camera) * zoom`, CSS px of the desk container.
 * - `entities()` is enumerated once per `sync()`; disappearing entities are
 *   torn down.
 *
 * Below `minScreenWidth` the card is hidden AND its slot content is unmounted,
 * which is the LOD budget a real bridge would need: a screen-space editor is
 * only affordable while the card is readable.
 */

export interface SuiteCardCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The slice of a kind's geometry the overlay needs (`PaperGeometry` satisfies it). */
export interface SuiteCardGeometry {
  readonly centre: readonly [number, number];
  readonly half: readonly [number, number];
  readonly angle: number;
  /** Presence, 1 at rest; 0 gone. Absent means 1. */
  readonly alpha?: number;
}

export interface SuiteCardBox {
  /** Screen-space top-left of the (unrotated) screen box, CSS px of the container. */
  readonly left: number;
  readonly top: number;
  /** Screen-space size, CSS px. */
  readonly width: number;
  readonly height: number;
  /** The object's size in world units — the size a NodeCard is laid out at. */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** The camera zoom; the content is laid out at world size and scaled by this. */
  readonly scale: number;
  readonly angleDeg: number;
}

/** A card narrower than this on screen is not a card any more; it is a chip. */
export const SUITE_CARD_MIN_SCREEN_WIDTH = 180;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * The card's box for one frame, or `null` when it must not be mounted.
 * `null` covers: missing/non-finite geometry, a non-positive or non-finite
 * camera zoom, a faded-out object, and a card below the readable width.
 */
export function suiteCardBox(
  geometry: SuiteCardGeometry | null | undefined,
  camera: SuiteCardCamera | null | undefined,
  minScreenWidth = SUITE_CARD_MIN_SCREEN_WIDTH,
): SuiteCardBox | null {
  if (geometry === null || geometry === undefined) return null;
  if (camera === null || camera === undefined) return null;
  const { centre, half } = geometry;
  const [cx, cy] = centre;
  const [hx, hy] = half;
  const zoom = camera.zoom;
  if (!finite(cx) || !finite(cy) || !finite(hx) || !finite(hy)) return null;
  if (!finite(camera.x) || !finite(camera.y) || !finite(zoom) || zoom <= 0) return null;
  if (!finite(geometry.angle)) return null;
  if ((geometry.alpha ?? 1) <= 0.01) return null;
  const worldWidth = Math.abs(hx) * 2;
  const worldHeight = Math.abs(hy) * 2;
  const width = worldWidth * zoom;
  const height = worldHeight * zoom;
  if (!(width >= minScreenWidth)) return null;
  return {
    left: (cx - camera.x) * zoom - width / 2,
    top: (cy - camera.y) * zoom - height / 2,
    width,
    height,
    worldWidth,
    worldHeight,
    scale: zoom,
    angleDeg: (geometry.angle * 180) / Math.PI,
  };
}

/** What a slot renderer is told about the object it is mounting into. */
export interface SuiteCardInfo {
  readonly entity: number;
  readonly title: string;
  readonly body: string;
  /**
   * The workspace card this object stands for. "" when the kind carries none,
   * which is the lab's case; a production renderer then mounts nothing.
   */
  readonly cardId: string;
  /** The board the card sits on; "" when the kind carries none. */
  readonly boardId: string;
  readonly worldWidth: number;
  readonly worldHeight: number;
}

/** The kind's display face, as `infoOf` reports it (`faceOf` in the kind). */
export interface SuiteCardFace {
  readonly title: string;
  readonly body: string;
  /** The card's id in the workspace document; absent in the lab. */
  readonly cardId?: string | undefined;
  /** The board the card is placed on; absent in the lab. */
  readonly boardId?: string | undefined;
}

/**
 * The seam a React surface takes: mount card UI into the slot's content
 * element (already sized in world units and scaled to the camera) and return
 * the teardown for the LOD unmount.
 */
export interface SuiteCardSlotRenderer {
  mount(content: HTMLElement, info: SuiteCardInfo): (() => void) | undefined;
}

export interface SuiteCardOverlayOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  /** Enumerate the kind's live entities, once per `sync()`. */
  readonly entities: () => Iterable<number>;
  readonly geometryOf: (entity: number) => SuiteCardGeometry | null | undefined;
  readonly camera: () => SuiteCardCamera | null | undefined;
  /** Title/body (and, in production, the card's ids) for the slot's content. */
  readonly infoOf?: (entity: number) => SuiteCardFace | undefined;
  readonly renderer?: SuiteCardSlotRenderer | undefined;
  readonly minScreenWidth?: number | undefined;
}

export interface SuiteCardOverlayHandle {
  /** The overlay root appended to the desk container. */
  readonly layer: HTMLElement;
  /** Position every card from the current camera and geometry. */
  sync(): void;
  /** Slots currently mounted (visible). */
  visibleCount(): number;
  dispose(): void;
}

interface Slot {
  readonly element: HTMLElement;
  readonly content: HTMLElement;
  cleanup: (() => void) | undefined;
  mounted: boolean;
}

const SLOT_CLASS = "suite-card-overlay__slot";
const CONTENT_CLASS = "suite-card-overlay__content";
const CARD_CLASS = "suite-card-overlay__card";
const TITLE_CLASS = "suite-card-overlay__title";
const BODY_CLASS = "suite-card-overlay__body";

function defaultCard(content: HTMLElement, info: SuiteCardInfo): void {
  const doc = content.ownerDocument;
  const card = doc.createElement("div");
  card.className = CARD_CLASS;
  card.dataset.testid = "suite-card-overlay-card";
  const title = doc.createElement("div");
  title.className = TITLE_CLASS;
  title.textContent = info.title.trim().length > 0 ? info.title : "Suite card";
  const body = doc.createElement("div");
  body.className = BODY_CLASS;
  body.textContent = info.body;
  card.append(title, body);
  content.append(card);
}

/**
 * Build the overlay. It is a plain DOM layer: one absolutely-positioned slot per
 * visible card, each holding a content element laid out in world units and
 * scaled to the camera. `sync()` is the one frame hook.
 */
export function createSuiteCardOverlay(opts: SuiteCardOverlayOptions): SuiteCardOverlayHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = "suite-card-overlay";
  layer.dataset.testid = "suite-card-overlay";
  layer.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;contain:layout style;";

  const slots = new Map<number, Slot>();

  const unmount = (slot: Slot): void => {
    slot.cleanup?.();
    slot.cleanup = undefined;
    slot.content.replaceChildren();
    slot.mounted = false;
  };

  const destroy = (entity: number, slot: Slot): void => {
    unmount(slot);
    slot.element.remove();
    slots.delete(entity);
  };

  const ensure = (entity: number): Slot => {
    const existing = slots.get(entity);
    if (existing !== undefined) return existing;
    const element = doc.createElement("div");
    element.className = SLOT_CLASS;
    element.dataset.entity = String(entity);
    element.style.cssText =
      "position:absolute;left:0;top:0;display:none;pointer-events:none;transform-origin:50% 50%;will-change:transform;";
    const content = doc.createElement("div");
    content.className = CONTENT_CLASS;
    content.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;";
    element.append(content);
    layer.append(element);
    const slot: Slot = { element, content, cleanup: undefined, mounted: false };
    slots.set(entity, slot);
    return slot;
  };

  const mount = (entity: number, slot: Slot, info: SuiteCardInfo): void => {
    if (opts.renderer !== undefined) {
      slot.cleanup = opts.renderer.mount(slot.content, info);
    } else {
      defaultCard(slot.content, info);
    }
    slot.mounted = true;
    slot.element.dataset.entity = String(entity);
  };

  const sync = (): void => {
    const camera = opts.camera();
    const seen = new Set<number>();
    for (const entity of opts.entities()) {
      seen.add(entity);
      const slot = ensure(entity);
      const box = suiteCardBox(opts.geometryOf(entity), camera, opts.minScreenWidth);
      if (box === null) {
        if (slot.mounted) unmount(slot);
        slot.element.style.display = "none";
        slot.element.dataset.visible = "false";
        continue;
      }
      const face = opts.infoOf?.(entity);
      const info: SuiteCardInfo = {
        entity,
        title: face?.title ?? "Suite card",
        body: face?.body ?? "suite.card — screen-space DOM half",
        cardId: face?.cardId ?? "",
        boardId: face?.boardId ?? "",
        worldWidth: box.worldWidth,
        worldHeight: box.worldHeight,
      };
      // The content is laid out at WORLD size and scaled: a real NodeCard keeps
      // its own px metrics (title 13, body 14) and the camera scales the whole.
      slot.content.style.width = `${box.worldWidth}px`;
      slot.content.style.height = `${box.worldHeight}px`;
      slot.content.style.transform = `scale(${box.scale})`;
      slot.element.style.display = "block";
      slot.element.dataset.visible = "true";
      slot.element.style.left = `${box.left}px`;
      slot.element.style.top = `${box.top}px`;
      slot.element.style.width = `${box.width}px`;
      slot.element.style.height = `${box.height}px`;
      slot.element.style.transform = `rotate(${box.angleDeg}deg)`;
      if (!slot.mounted) mount(entity, slot, info);
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
      for (const slot of slots.values()) if (slot.mounted) count += 1;
      return count;
    },
    dispose: () => {
      for (const [entity, slot] of slots) destroy(entity, slot);
      layer.remove();
    },
  };
}
