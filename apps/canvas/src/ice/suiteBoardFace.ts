/**
 * The visible face of `suite.board` — the legible half of a Board, drawn in
 * screen space over ICE's mat (ADR-0036 §5, ADR-0039, ADR-0043).
 *
 * WHY A DOM FACE AT ALL — a Board is a container, so its identity has to outrank
 * its contents exactly where its contents stop being readable: at fit zoom. The
 * mat's own printed name is a world-space print (`MINIMAT.print.name`): it is a
 * smudge below ~5×, which is why the kind tells the mat to print no name at all
 * and this layer carries the only one. Text that must be read at every zoom can
 * only be text that does not scale with the world, so the name and its colour
 * dot are CSS pixels here, and the GPU mat stays what it is good at — a sheet in
 * the Board's own material (one of six, ADR-0043), with a shadow, pickable on
 * exactly its rect.
 *
 * WHAT IS CONSTANT AND WHAT IS NOT:
 * - the NAME and the COLOUR are laid out in CSS px and never scale with the
 *   camera, and they are drawn at REST: an unselected Board still says what it
 *   is called. Selection adds detail (the card count), it does not reveal the
 *   name;
 * - the MAT follows the projected footprint exactly, with no legible minimum: a
 *   Board's rect is geometry the user authored, so the face may never draw a mat
 *   bigger or smaller than the one ICE picks on.
 *
 * The stack behind the mat is the type graph's (`suiteGraphDepth`): one plate per
 * shallower level, up and left, slightly small — a pile of sheets implies height
 * without a horizon (ADR-0036).
 *
 * This module imports no ICE runtime, so it is pure DOM + arithmetic and is
 * unit-tested in jsdom. It never reads the document and never writes one.
 */

import type { boardColors } from "@suite/graph";

/** The screen-space camera, as ICE's `Camera` resource exposes it. */
export interface SuiteBoardFaceCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A box in screen pixels — the one shape every part of the face is placed by. */
export interface BoardFaceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One plate of the 2.5D stack behind the mat. */
export interface BoardFacePlate extends BoardFaceRect {
  readonly level: number;
  /** Shadow weight, `0` at the surface … `1` at the deepest level. */
  readonly shadow: number;
}

/** A child Board's chip, or the `+n` marker that stands in for the rest. */
export interface BoardFaceChip extends BoardFaceRect {
  readonly key: string;
  /** `0` for a child's own chip; `n > 0` for the marker that means "n more". */
  readonly overflow: number;
}

/**
 * The bands a Board's face is drawn in. `hidden` is below the band where a name
 * could still be read: a mat that small is a dot, and a dot with a label is noise
 * (the camera's ceiling is `EMPTY_VIEW_ZOOM`, 0.12, well inside `compact`).
 */
export type SuiteBoardFaceBand = "hidden" | "compact" | "full";

/** Fit zoom (0.12) and the graph band (≈0.06) both sit above this. */
/**
 * The 2.5D stack a Board's plates follow (ADR-0036 §4): depth is *derived* from
 * containment and only ever moves a face by a few pixels, never a position. The
 * helpers live here now that the type graph — which used to own them — is
 * withdrawn (ADR-0041): a Board is the only thing that stacks.
 */
export const BOARD_DEPTH_STEP_PX = 5;

/** How many plates may be drawn; past this the pile stops being readable. */
export const BOARD_DEPTH_MAX_LEVEL = 3;

/** A Board's containment depth as a plate level, clamped. */
export function boardDepthLevel(depth: number): number {
  if (!Number.isFinite(depth)) return 0;
  return Math.min(BOARD_DEPTH_MAX_LEVEL, Math.max(0, Math.round(depth)));
}

/** What a level changes about a plate's shadow: deeper plates cast a softer one. */
export function boardDepthOffset(level: number): { level: number; shadow: number } {
  const value = boardDepthLevel(level);
  return { level: value, shadow: 0.18 + value * 0.06 };
}

/** A child count as the chip row's own number, or 0 when there is nothing to say. */
export function boardChildCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(99, Math.floor(count));
}

export const SUITE_BOARD_FACE_COMPACT_ZOOM = 0.04;

/** The zoom from which a Board has room for its children's chips and its count. */
export const SUITE_BOARD_FACE_FULL_ZOOM = 0.4;

/** The name's box: one line, drawn above the mat's top edge. */
export const SUITE_BOARD_FACE_TITLE = {
  height: 18,
  /** The gap between the name's box and the mat's top edge. */
  gap: 4,
  /** Below this the name is unreadable, so the box may overhang a small mat. */
  minWidth: 72,
  /** Above this a long name is ellipsised rather than laid across its neighbours. */
  maxWidth: 240,
} as const;

/** The colour's stripe along the mat's top edge. */
export const SUITE_BOARD_FACE_ACCENT_HEIGHT = 3;

/**
 * The colour chip in a Board's top-left corner. A full-width bar reads as a
 * stray rule lying across the canvas; a short tab reads as the mat's label
 * stripe, which is what a desk mat actually has.
 */
export const SUITE_BOARD_FACE_ACCENT_TAB = { inset: 10, width: 44 } as const;

/** The chip row along the mat's bottom edge, drawn only at `full`. */
export const SUITE_BOARD_FACE_CHIP = {
  width: 64,
  height: 14,
  gap: 4,
  /** The row's inset from the mat's edge. */
  inset: 6,
  /** At most this many chips: past it the last one is a `+n` marker. */
  max: 4,
  /** A chip narrower than this is not a chip; the row is dropped instead. */
  minWidth: 18,
} as const;

/** The name a Board prints when it has none — the projection's own fallback. */
export const SUITE_BOARD_FACE_UNTITLED = "Board";

/** A Board's colour: the palette `@suite/graph` validates every Board against. */
export type SuiteBoardColor = (typeof boardColors)[number];

/** Each board colour's light-mode value, used when the CSS token is absent. */
const BOARD_ACCENTS: Readonly<Record<SuiteBoardColor, string>> = {
  slate: "#64748b",
  blue: "#3b82f6",
  green: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
};

/** What a face paints when its colour prop is missing or not a board colour. */
export const SUITE_BOARD_FACE_ACCENT_FALLBACK = `var(--section-slate, ${BOARD_ACCENTS.slate})`;

/**
 * A Board's colour as CSS. The name is matched against the palette first, so a
 * hand-edited prop can only ever name a colour the app actually defines — never
 * an arbitrary declaration (the rule `suiteGraphFace` applies to swatches).
 */
export function boardAccent(color: string | undefined): string {
  if (color === undefined) return SUITE_BOARD_FACE_ACCENT_FALLBACK;
  if (!Object.hasOwn(BOARD_ACCENTS, color)) return SUITE_BOARD_FACE_ACCENT_FALLBACK;
  const known = color as SuiteBoardColor;
  return `var(--section-${known}, ${BOARD_ACCENTS[known]})`;
}

/** The band a Board at this zoom draws its face in. */
export function boardFaceBand(zoom: number | undefined): SuiteBoardFaceBand {
  if (zoom === undefined || !Number.isFinite(zoom) || zoom <= 0) return "hidden";
  if (zoom >= SUITE_BOARD_FACE_FULL_ZOOM) return "full";
  if (zoom >= SUITE_BOARD_FACE_COMPACT_ZOOM) return "compact";
  return "hidden";
}

/** A size from a projection or a hand edit: never negative, never NaN. */
function extent(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The mat's box in screen pixels — the rect ICE picks on, exactly. */
export interface BoardFaceMat extends BoardFaceRect {
  readonly level: number;
  readonly shadow: number;
}

/**
 * The name's box and the text it carries. The text lives here (not in the DOM
 * half) so the pure layout is the single place that decides what a Board calls
 * itself.
 */
export interface BoardFaceTitle extends BoardFaceRect {
  readonly text: string;
}

export interface BoardFaceLayoutInput {
  /** The mat's left edge, screen px (already projected by the caller). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The camera's zoom — bands the face; it never scales its text. */
  readonly zoom: number;
  /** The Board's nesting depth below the root plane (ADR-0039). */
  readonly depth: number;
  readonly name: string;
  /** A `boardColors` value; anything else paints the fallback accent. */
  readonly color: string;
  readonly childCount: number;
  /** A collapsed Board hides its contents, so it advertises none of them. */
  readonly collapsed?: boolean | undefined;
}

export interface BoardFaceLayout {
  readonly band: SuiteBoardFaceBand;
  /** The mat as projected — always the footprint, never a legible minimum. */
  readonly mat: BoardFaceMat;
  /** The plates behind the mat, shallowest first. */
  readonly plates: readonly BoardFacePlate[];
  /** The name above the mat's top edge; `null` below `compact`. */
  readonly title: BoardFaceTitle | null;
  /** The colour's stripe along the mat's top edge; `null` below `compact`. */
  readonly accent: BoardFaceRect | null;
  /** The Board's colour as CSS, mapped from the six `boardColors`. */
  readonly accentColor: string;
  /** Child chips along the bottom edge — `full` only, and only with room. */
  readonly chips: readonly BoardFaceChip[];
}

/**
 * A Board's plate is the mat's own size, displaced down and right: the mat is the
 * top of the pile, so the sheets under it peek out at its bottom-right corner —
 * the same step the type graph's faces take. Shrinking a plate (as the graph's
 * chips do) would read as the mat's shadow rather than as another sheet under
 * it, because a 640-unit board loses dozens of pixels to a 4 % scale long before
 * a 5 px step shows.
 */
function plateAt(mat: BoardFaceRect, level: number, top: number): BoardFacePlate {
  const offset = boardDepthOffset(level);
  const step = (top - level) * BOARD_DEPTH_STEP_PX;
  return {
    left: mat.left + step,
    top: mat.top + step,
    width: mat.width,
    height: mat.height,
    level: offset.level,
    shadow: offset.shadow,
  };
}

/** One plate per shallower level, so the pile reads bottom-right of the mat. */
function depthStack(mat: BoardFaceRect, depth: number): BoardFacePlate[] {
  const level = boardDepthLevel(depth);
  const plates: BoardFacePlate[] = [];
  for (let shallower = 0; shallower < level; shallower += 1) {
    plates.push(plateAt(mat, shallower, level));
  }
  return plates;
}

/**
 * The chip row for a Board at the `full` band: as many child chips as fit, with
 * the last one standing in for the children that do not. Dropped whole rather
 * than drawn at a sub-chip size — a row of slivers says nothing about a Board's
 * contents.
 */
function chipRow(
  mat: BoardFaceRect,
  childCount: number,
  band: SuiteBoardFaceBand,
  collapsed: boolean,
): BoardFaceChip[] {
  if (band !== "full" || collapsed) return [];
  const children = boardChildCount(childCount);
  if (children === 0) return [];
  const { inset, height, gap, max, minWidth, width } = SUITE_BOARD_FACE_CHIP;
  const available = mat.width - inset * 2;
  const top = mat.top + mat.height - inset - height;
  if (available <= 0 || top < mat.top) return [];
  const wanted = Math.min(children, max);
  const slot = (available - gap * (wanted - 1)) / wanted;
  if (slot < minWidth) return [];
  const chipWidth = Math.min(width, slot);
  const overflow = children > max;
  const childChips = overflow ? wanted - 1 : wanted;
  const chips: BoardFaceChip[] = [];
  for (let index = 0; index < wanted; index += 1) {
    const isOverflow = overflow && index === wanted - 1;
    chips.push({
      key: isOverflow ? "chip:more" : `chip:${index}`,
      left: mat.left + inset + index * (chipWidth + gap),
      top,
      width: chipWidth,
      height,
      overflow: isOverflow ? children - childChips : 0,
    });
  }
  return chips;
}

/**
 * A Board's whole face for one frame. `x`, `y`, `width` and `height` are the
 * mat's **screen** rect (the caller projects the world rect); `zoom` only picks
 * the band. Pure: same input, same output, no camera read, no clock.
 */
export function boardFaceLayout(input: BoardFaceLayoutInput): BoardFaceLayout {
  const band = boardFaceBand(input.zoom);
  const level = boardDepthLevel(input.depth);
  const mat: BoardFaceMat = {
    left: Number.isFinite(input.x) ? input.x : 0,
    top: Number.isFinite(input.y) ? input.y : 0,
    width: extent(input.width),
    height: extent(input.height),
    level,
    shadow: boardDepthOffset(level).shadow,
  };
  const accentColor = boardAccent(input.color);
  if (band === "hidden") {
    return { band, mat, plates: [], title: null, accent: null, accentColor, chips: [] };
  }
  const trimmed = input.name.trim();
  const title: BoardFaceTitle = {
    left: mat.left,
    top: mat.top - SUITE_BOARD_FACE_TITLE.gap - SUITE_BOARD_FACE_TITLE.height,
    width: clamp(mat.width, SUITE_BOARD_FACE_TITLE.minWidth, SUITE_BOARD_FACE_TITLE.maxWidth),
    height: SUITE_BOARD_FACE_TITLE.height,
    text: trimmed.length > 0 ? trimmed : SUITE_BOARD_FACE_UNTITLED,
  };
  const { inset: accentInset, width: accentWidth } = SUITE_BOARD_FACE_ACCENT_TAB;
  const accent: BoardFaceRect = {
    left: mat.left + accentInset,
    top: mat.top + accentInset,
    // Never wider than the mat it labels, however narrow a Board is.
    width: Math.max(0, Math.min(accentWidth, mat.width - accentInset * 2)),
    height: Math.min(SUITE_BOARD_FACE_ACCENT_HEIGHT, Math.max(0, mat.height - accentInset * 2)),
  };
  return {
    band,
    mat,
    plates: depthStack(mat, input.depth),
    title,
    accent,
    accentColor,
    chips: chipRow(mat, input.childCount, band, input.collapsed === true),
  };
}

/** One Board as the layer paints it — props only, never a document read. */
export interface SuiteBoardFaceNode {
  /** Stable DOM identity across frames (the entity id, as a string). */
  readonly id: string;
  /** The mat's rect in world units. */
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly depth: number;
  readonly name: string;
  /** A `boardColors` value; anything else paints the fallback accent. */
  readonly color: string;
  readonly cardCount: number;
  readonly childCount: number;
  readonly collapsed: boolean;
}

export interface SuiteBoardFaceLayerOptions {
  /** The ICE desk's screen-space container (`ObjectDomHost.container`). */
  readonly container: HTMLElement;
  /** Enumerate the kind's live Boards, once per `sync()`. */
  readonly nodes: () => Iterable<SuiteBoardFaceNode>;
  /**
   * Whether a Board is selected *right now*. The name is drawn either way (a
   * Board's identity is not a selection state); selection adds the card count,
   * the one number a reader wants only about the Board they are working on.
   */
  readonly selected?: ((id: string) => boolean) | undefined;
  readonly camera: () => SuiteBoardFaceCamera | null | undefined;
  /** The layer's stacking order against the desk's other screen-space halves. */
  readonly zIndex?: number | undefined;
}

export interface SuiteBoardFaceLayerHandle {
  /** The layer root appended to the desk container. */
  readonly layer: HTMLElement;
  /** Place and paint every Board from the current camera and geometry. */
  sync(): void;
  /** Boards currently drawn (visible). */
  visibleCount(): number;
  dispose(): void;
}

interface BoardSlot {
  readonly mat: HTMLElement;
  readonly accent: HTMLElement;
  readonly title: HTMLElement;
  readonly dot: HTMLElement;
  readonly label: HTMLElement;
  readonly count: HTMLElement;
  readonly plates: HTMLElement[];
  readonly chips: HTMLElement[];
  visible: boolean;
}

const LAYER_CLASS = "suite-board-face-layer";
const MAT_CLASS = "suite-board-face";
const PLATE_CLASS = "suite-board-face__plate";
const ACCENT_CLASS = "suite-board-face__accent";
const TITLE_CLASS = "suite-board-face__title";
const LABEL_CLASS = "suite-board-face__label";
const DOT_CLASS = "suite-board-face__dot";
const COUNT_CLASS = "suite-board-face__count";
const CHIP_CLASS = "suite-board-face__chip";

/** Paint order inside the layer: plates under the mat, the name over everything. */
const Z = { plate: 0, mat: 10, accent: 11, chip: 12, title: 13 } as const;

function shadowOf(weight: number): string {
  const blur = 2 + weight * 10;
  const spread = weight * 2;
  const alpha = 0.12 + weight * 0.18;
  return `0 ${1 + weight * 3}px ${blur}px ${spread}px rgba(0,0,0,${alpha.toFixed(3)})`;
}

/** A world rect under the camera, or `null` when either is unusable. */
function project(
  rect: SuiteBoardFaceNode["rect"],
  camera: SuiteBoardFaceCamera | null | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (camera === null || camera === undefined) return null;
  if (![rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value))) {
    return null;
  }
  if (![camera.x, camera.y, camera.zoom].every((value) => Number.isFinite(value))) return null;
  if (camera.zoom <= 0) return null;
  const zoom = camera.zoom;
  return {
    x: (rect.x - camera.x) * zoom,
    y: (rect.y - camera.y) * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
  };
}

/**
 * The screen-space half: one mat, its plates, its stripe, its chips and its name
 * per Board, all in CSS pixels inside one inert layer, so the camera moves the
 * face without ever scaling its text. `sync()` is the one frame hook; the kind
 * hangs it on its `KindLocal.tick`, so the desk still sleeps when nothing moves.
 */
export function createSuiteBoardFaceLayer(
  opts: SuiteBoardFaceLayerOptions,
): SuiteBoardFaceLayerHandle {
  const doc = opts.container.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = LAYER_CLASS;
  layer.dataset.testid = LAYER_CLASS;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${
    opts.zIndex ?? 3
  };contain:layout style;`;

  const slots = new Map<string, BoardSlot>();

  const destroy = (id: string): void => {
    const slot = slots.get(id);
    if (slot === undefined) return;
    slot.mat.remove();
    slot.accent.remove();
    slot.title.remove();
    for (const plate of slot.plates) plate.remove();
    for (const chip of slot.chips) chip.remove();
    slots.delete(id);
  };

  const ensure = (node: SuiteBoardFaceNode): BoardSlot => {
    const existing = slots.get(node.id);
    if (existing !== undefined) return existing;
    // The mat is its own box; the plates, the stripe, the chips and the name are
    // siblings, so no part inherits another's text layout.
    const mat = doc.createElement("div");
    mat.className = MAT_CLASS;
    mat.dataset.testid = MAT_CLASS;
    mat.style.cssText =
      "position:absolute;box-sizing:border-box;border-radius:10px;background:color-mix(in srgb, var(--surface, #fff) 14%, transparent);";

    const accent = doc.createElement("div");
    accent.className = ACCENT_CLASS;
    accent.dataset.testid = ACCENT_CLASS;
    accent.style.cssText = "position:absolute;border-radius:2px;";

    // The name is text over arbitrary content — a card, the desk, another Board —
    // so it carries its own pill instead of trusting what is under it. That also
    // keeps its contrast a fact rather than a hope (the desk's a11y gate reads it).
    const title = doc.createElement("div");
    title.className = TITLE_CLASS;
    title.dataset.testid = TITLE_CLASS;
    title.style.cssText =
      "position:absolute;display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;border-radius:6px;padding:0 6px;font:600 12px/16px ui-sans-serif,system-ui,sans-serif;";

    const dot = doc.createElement("span");
    dot.className = DOT_CLASS;
    dot.dataset.testid = DOT_CLASS;
    dot.style.cssText = "flex:none;width:6px;height:6px;border-radius:2px;";

    const label = doc.createElement("span");
    label.className = LABEL_CLASS;
    label.dataset.testid = LABEL_CLASS;
    label.style.cssText =
      "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

    const count = doc.createElement("span");
    count.className = COUNT_CLASS;
    count.dataset.testid = COUNT_CLASS;
    count.style.cssText =
      "flex:none;font:600 10px/12px ui-sans-serif,system-ui,sans-serif;padding:1px 5px;border-radius:999px;";

    title.append(dot, label, count);
    layer.append(mat, accent, title);
    const slot: BoardSlot = {
      mat,
      accent,
      title,
      dot,
      label,
      count,
      plates: [],
      chips: [],
      visible: true,
    };
    slots.set(node.id, slot);
    return slot;
  };

  const paintPlates = (slot: BoardSlot, layout: BoardFaceLayout, visible = true): void => {
    while (slot.plates.length < layout.plates.length) {
      const plate = doc.createElement("div");
      plate.className = PLATE_CLASS;
      plate.dataset.testid = PLATE_CLASS;
      plate.style.cssText =
        "position:absolute;box-sizing:border-box;pointer-events:none;border-radius:10px;";
      layer.append(plate);
      slot.plates.push(plate);
    }
    slot.plates.forEach((plate, index) => {
      if (!visible) {
        plate.style.display = "none";
        return;
      }
      const step = layout.plates[index];
      if (step === undefined) {
        plate.style.display = "none";
        return;
      }
      plate.style.display = "block";
      plate.style.left = `${step.left}px`;
      plate.style.top = `${step.top}px`;
      plate.style.width = `${step.width}px`;
      plate.style.height = `${step.height}px`;
      plate.style.zIndex = `${Z.plate + step.level}`;
      // A sheet under the mat: a tint of the same colour, and no outline —
      // several offset outlines read as nested selection rings.
      plate.style.background = "color-mix(in srgb, var(--suite-board-accent) 10%, transparent)";
      plate.style.opacity = `${0.5 + step.level * 0.1}`;
      plate.style.setProperty("--suite-board-accent", layout.accentColor);
      plate.style.boxShadow = shadowOf(step.shadow);
    });
  };

  const paintChips = (slot: BoardSlot, layout: BoardFaceLayout, visible = true): void => {
    while (slot.chips.length < layout.chips.length) {
      const chip = doc.createElement("div");
      chip.className = CHIP_CLASS;
      chip.dataset.testid = CHIP_CLASS;
      chip.style.cssText =
        "position:absolute;box-sizing:border-box;border-radius:4px;display:flex;align-items:center;justify-content:center;font:600 9px/11px ui-sans-serif,system-ui,sans-serif;overflow:hidden;";
      layer.append(chip);
      slot.chips.push(chip);
    }
    slot.chips.forEach((element, index) => {
      if (!visible) {
        element.style.display = "none";
        return;
      }
      const chip = layout.chips[index];
      if (chip === undefined) {
        element.style.display = "none";
        return;
      }
      element.style.display = "flex";
      element.style.left = `${chip.left}px`;
      element.style.top = `${chip.top}px`;
      element.style.width = `${chip.width}px`;
      element.style.height = `${chip.height}px`;
      element.style.zIndex = `${Z.chip + layout.mat.level}`;
      element.dataset.key = chip.key;
      element.style.setProperty("--suite-board-accent", layout.accentColor);
      element.style.border = "1px solid var(--suite-board-accent)";
      element.style.background = "color-mix(in srgb, var(--suite-board-accent) 18%, transparent)";
      element.style.color = "var(--ink, #1d1d1f)";
      element.textContent = chip.overflow > 0 ? `+${chip.overflow}` : "";
    });
  };

  const paint = (slot: BoardSlot, node: SuiteBoardFaceNode, layout: BoardFaceLayout): void => {
    // The mat is the Board's body; the face adds only what the mat cannot say.
    const isSelected = opts.selected?.(node.id) === true;
    const { mat } = layout;
    const level = mat.level;
    const cards = boardChildCount(node.cardCount);
    const noun = cards === 1 ? "card" : "cards";
    // The Board's *face* — the sheet, its edge, its shadow — is the GPU mat
    // drawn under this layer. Painting a second translucent box over it reads as
    // an overlay sticker, so the DOM half keeps only what the GPU cannot do:
    // the name, crisp at every zoom, and its colour dot.
    slot.mat.style.display = "none";
    slot.mat.dataset.band = layout.band;
    slot.mat.dataset.color = node.color;
    slot.mat.dataset.collapsed = node.collapsed ? "true" : "false";
    slot.mat.style.left = `${mat.left}px`;
    slot.mat.style.top = `${mat.top}px`;
    slot.mat.style.width = `${mat.width}px`;
    slot.mat.style.height = `${mat.height}px`;
    slot.mat.style.zIndex = `${Z.mat + level}`;
    slot.mat.style.setProperty("--suite-board-accent", layout.accentColor);
    slot.mat.title = `${layout.title?.text ?? node.name} — ${cards} ${noun}`;

    // The 2.5D plate stack is off with the frame: a pile of translucent sheets
    // over a GPU mat that already has its own edge doubles the visual weight.
    paintPlates(slot, layout, false);

    // The colour lives on the title's dot: a tab or a stripe on the mat is the
    // overlay we are removing.
    const accent = null as BoardFaceRect | null;
    slot.accent.style.display = "none";
    if (accent !== null) {
      slot.accent.style.left = `${accent.left}px`;
      slot.accent.style.top = `${accent.top}px`;
      slot.accent.style.width = `${accent.width}px`;
      slot.accent.style.height = `${accent.height}px`;
      slot.accent.style.zIndex = `${Z.accent + level}`;
      slot.accent.style.background = layout.accentColor;
    }

    // No chips: they were the last overlay on an idle Board. The count rides the
    // name pill, which a selected Board also shows.
    paintChips(slot, { ...layout, chips: [] }, false);

    // The NAME is the face, at rest and when selected (ADR-0043): a Board is a
    // container whose identity must outrank its contents exactly where its
    // contents stop being readable, and the GPU mat prints nothing legible below
    // ~5×. Selection adds detail (the card count); it never reveals the name.
    const title = layout.title;
    slot.title.style.display = title === null ? "none" : "flex";
    slot.title.dataset.selected = isSelected ? "true" : "false";
    if (title !== null) {
      slot.title.style.left = `${title.left}px`;
      slot.title.style.top = `${title.top}px`;
      // The box is the most the name may take; the pill hugs a short name to
      // its own width and ellipsises a long one at the ceiling.
      slot.title.style.width = "fit-content";
      slot.title.style.maxWidth = `${title.width}px`;
      slot.title.style.height = `${title.height}px`;
      slot.title.style.zIndex = `${Z.title + level}`;
      slot.title.dataset.band = layout.band;
      slot.title.style.color = "var(--ink, #1d1d1f)";
      // At rest the pill is a label; selected it is the one Board in focus — a
      // solid sheet and its full accent, not a second overlay.
      slot.title.style.background = isSelected
        ? "var(--surface, #fff)"
        : "color-mix(in srgb, var(--surface, #fff) 92%, transparent)";
      slot.title.style.border = `1px solid color-mix(in srgb, var(--suite-board-accent) ${
        isSelected ? 100 : 45
      }%, transparent)`;
      slot.title.style.setProperty("--suite-board-accent", layout.accentColor);
      slot.title.title = `${title.text} — ${cards} ${noun}`;
      slot.dot.style.background = layout.accentColor;
      slot.label.textContent = title.text;
      // The count is the selected state's addition: at rest a Board says its
      // name and its colour, which is what the mat itself cannot say.
      slot.count.style.display = isSelected ? "inline-block" : "none";
      slot.count.textContent = `${cards}`;
      slot.count.title = `${cards} ${noun}`;
      slot.count.style.color = "var(--ink, #1d1d1f)";
      slot.count.style.background =
        "color-mix(in srgb, var(--suite-board-accent) 18%, transparent)";
    }

    slot.visible = true;
  };

  const hide = (slot: BoardSlot): void => {
    slot.mat.style.display = "none";
    slot.accent.style.display = "none";
    slot.title.style.display = "none";
    for (const plate of slot.plates) plate.style.display = "none";
    for (const chip of slot.chips) chip.style.display = "none";
    slot.visible = false;
  };

  const sync = (): void => {
    const camera = opts.camera();
    const seen = new Set<string>();
    for (const node of opts.nodes()) {
      seen.add(node.id);
      const slot = ensure(node);
      const rect = project(node.rect, camera);
      if (rect === null || camera === null || camera === undefined) {
        hide(slot);
        continue;
      }
      slot.mat.style.display = "block";
      paint(
        slot,
        node,
        boardFaceLayout({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          zoom: camera.zoom,
          depth: node.depth,
          name: node.name,
          color: node.color,
          childCount: node.childCount,
          collapsed: node.collapsed,
        }),
      );
    }
    for (const id of [...slots.keys()]) {
      if (!seen.has(id)) destroy(id);
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
      for (const id of [...slots.keys()]) destroy(id);
      layer.remove();
    },
  };
}
