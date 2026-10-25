/**
 * `suite.card` — a real Suite card face drawn by ICE.
 *
 * GPU backing: the built-in paper program (`paperKind()`), reused under this
 * kind's own name so the ground compiles a paper pass for `suite.card` beside
 * the note's. The paper kind's world half is reused for `record`, `hit`, `chip`
 * and `theme`; only `resolve` changes — a card is square to the mat, so the
 * note's ±2.5° seed tilt is removed. No WGSL is invented.
 *
 * DOM half: `host.mount` appends the overlay and registers its `sync` on the
 * kind's `KindLocal.tick`. That is the frame hook ICE already ticks before each
 * build — no private rAF loop, and `due() === Infinity` lets the desk sleep when
 * nothing moves. The overlay unmounts card content below the readable width,
 * which is where the screen-space editor budget lives.
 *
 * The DOM half's *content* is a pluggable slot renderer (`setSuiteCardSlotRenderer`):
 * - `createWorkspaceCardSlotRenderer()` (production) mounts the existing
 *   `CardSurface`/`NodeCard` shell for the live card named by this object's
 *   `cardId` prop, read-only. It reads the workspace document and writes
 *   nothing; ICE supplies geometry only.
 * - `createNodeCardSlotRenderer()` (the `suite-card-lab.html` harness) mints a
 *   local document per mount and is never used for a real card.
 *
 * What works with no extra bridge (verified in the headed smoke): selection,
 * drag, camera pan and wheel zoom. The overlay is `pointer-events:none`, so all
 * pointer input reaches ICE's one interaction stack and picks the GPU rect; the
 * overlay only follows `geometryOf()`.
 *
 * What a product bridge still needs:
 * - INTERACTION: a mode switch that gives the overlay `pointer-events:auto`
 *   while an ICE selection is the card and the camera is readable, then routes
 *   pointerdown to ICE for drag/selection and to the card for text. Today the
 *   card is read-only and every press drags the object.
 * - LOD/PICK: hide below a readable width (done). A far card needs a chip
 *   impostor or the GPU paper alone; ICE's pick still needs the GPU rect while
 *   the DOM half is hidden, which the paper record provides.
 * - FOCUS: route keyboard focus and Escape between the DOM editor and ICE's
 *   keymap; a focused text field must stop ICE's shortcuts.
 * - WRITES: all edits must go through `@suite/graph`/Loro, never into ICE's
 *   document. This kind's props are display-only: `title`/`body` are the lab's
 *   face, `cardId`/`boardId` are the production card's coordinates.
 */

import {
  Camera,
  type Component,
  defineQuery,
  type Entity,
  Position,
  PrefabId,
  p,
  Size,
  type World,
} from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  defineObject,
  type KindDriver,
  type KindLocal,
} from "@vibecook/ice/desk";
import { PENS, paperKind } from "@vibecook/ice/desk/objects";
import {
  cardFaceAtBand,
  cardFaceBand,
  cardFaceOf,
  cardFaceRevisionOf,
  publishCardFaceBand,
} from "./suiteCardFace";
import {
  createSuiteCardOverlay,
  type SuiteCardFace,
  type SuiteCardOverlayHandle,
  type SuiteCardSlotRenderer,
} from "./suiteCardOverlay";
import {
  CARD_BASE_SCALE,
  type CardTypeScale,
  cardTypeForScale,
  SUITE_TYPE_LADDER,
  scaleForExtent,
} from "./suiteCardScale";
import { handForScale, SUITE_CARD_DOM_FACE, SUITE_FACE } from "./suitePen";

/** The object type and its kind share the name; both are unique on this desk. */
export const SUITE_CARD_TYPE = "suite.card";
export const SUITE_CARD_KIND = "suite.card";

/** The lab card's world size — Suite's `DEFAULT_CARD_WIDTH/HEIGHT`. */
export const SUITE_CARD_SIZE = { w: 288, h: 240 } as const;

/** Every widget carries `PrefabId`; the overlay filters it by our type id. */
const WIDGETS = defineQuery([PrefabId]);

/** The paper program's geometry (the type is not re-exported by the objects package). */
type PaperKindOf = ReturnType<typeof paperKind>;
type PaperGeometry = Parameters<PaperKindOf["record"]>[0];

/**
 * The screen-space renderer registry. Empty by default so the kind renders a
 * minimal DOM card with no React/Loro dependency; the production ICE surface
 * registers `createWorkspaceCardSlotRenderer()` and the lab registers its own
 * local-document renderer before the desk mounts.
 */
let slotRenderer: SuiteCardSlotRenderer | undefined;

export function setSuiteCardSlotRenderer(next: SuiteCardSlotRenderer | undefined): void {
  slotRenderer = next;
}

/** Our kind's per-desk state: the overlay's frame hook, and the writing's band door. */
interface SuiteCardLocal extends KindLocal, Partial<PaperWritingDraw> {
  setSink(sink: (() => void) | undefined): void;
}

/**
 * The slice of the paper writing this kind narrows: `draw`, where the text a
 * sheet lays out is decided. The engine does not re-export the `Writing` type
 * from its public entry, so it is stated here in the shape the paper's own
 * `record` calls it (`objects/src/paper/writing.ts`).
 */
interface PaperWritingDraw {
  draw(
    entity: Entity,
    props: Readonly<Record<string, unknown>>,
    rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number },
    view: { readonly zoom: number; readonly dpr: number },
    geometry: PaperGeometry,
    fading?: boolean,
  ): object;
}

/** How many face bands a raster rung is multiplied by, so the two never collide. */
const SUITE_CARD_BAND_STEPS = 4;

/** The face revision's span (`cardFaceRevision` is 16 bits) — the rung's middle term. */
const SUITE_CARD_REVISION_SPAN = 0x10000;

/** One rung step per revision and band, with room for the raster rung below them. */
const SUITE_CARD_RUNG_SPAN = SUITE_CARD_REVISION_SPAN * SUITE_CARD_BAND_STEPS;

/** A card the projection has published nothing for: its own prop's text stands. */
const SUITE_CARD_NO_FACE = 0;

/** The band a card of this on-screen width draws, as a small integer for the rung. */
function cardFaceBandIndexOf(screenWidth: number): number {
  const band = cardFaceBand(screenWidth);
  return band === "icon" ? 0 : band === "compact" ? 1 : 2;
}

/**
 * What the sheet writes this frame.
 *
 * The card's face is *banded by its own width on screen* (ADR-0043 §2): `icon`
 * writes nothing, `compact` writes the title row, `full` writes the whole flow.
 * The flow is one string — the projection cannot know the band, because only the
 * kind sees the camera — so the truncation happens here, at the one door the
 * paper takes its text through.
 */
export function suiteCardWrite(text: string, screenWidth: number): string {
  return cardFaceAtBand(text, cardFaceBand(screenWidth));
}

function createSuiteCardLocal(base: KindLocal | undefined): SuiteCardLocal {
  let sink: (() => void) | undefined;
  const writing = base as (KindLocal & Partial<PaperWritingDraw>) | undefined;
  const inheritDraw = writing?.draw?.bind(writing);
  return {
    // Keep the paper writing's own state (the reused `record` reads it).
    ...base,
    // The band is applied here rather than at spawn: the projection builds the
    // flow once per document change, and a zoom crossing must not replace the
    // entity (which would drop a selection mid-gesture) to change a word. The
    // card's own on-screen width is the only fact that bands it, and this is the
    // one place that sees both the sheet's box and the frame's zoom.
    draw: (entity, props, rect, view, geometry, fading) => {
      // What the projection published is the face; the prop is what the boot
      // wrote and is only the answer for a card no projection owns (the lab).
      const published = cardFaceOf(String(props.cardId ?? ""));
      const flow = published ?? (typeof props.text === "string" ? props.text : "");
      const width = rect.w * (Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1);
      const band = cardFaceBand(width);
      publishCardFaceBand(String(props.cardId ?? ""), band, width);
      const next = { ...props, text: cardFaceAtBand(flow, band) };
      return inheritDraw?.(entity, next, rect, view, geometry, fading) ?? {};
    },
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

/**
 * What the DOM half needs of the kind's driver: a place to hang the overlay's
 * sync. The driver itself follows nothing (idle always true), so it never keeps
 * the desk awake.
 */
interface SuiteCardDriver extends KindDriver {
  attach(overlay: SuiteCardOverlayHandle): void;
}

/** A desk object definition, as `defineObject` returns it. */
type DeskObject = ReturnType<typeof defineObject>;

/** One rung of the type ladder: its kind, its object and its `face` group. */
export interface SuiteCardRung {
  readonly scale: CardTypeScale;
  readonly type: string;
  /** The desk object for this rung — registered once per rung. */
  readonly object: DeskObject;
  /** The `face` group's component, so a card's text is read without a registry lookup. */
  readonly face: Component<SuiteCardFace>;
}

function createSuiteCardRung(scale: CardTypeScale): SuiteCardRung {
  const type = cardTypeForScale(scale);
  const paper = paperKind({
    hand: { law: handForScale(scale), face: SUITE_FACE, bleed: 0 },
  });
  const kind: PaperKindOf = {
    ...paper,
    name: type,
    resolve(ctx) {
      const geometry = paper.resolve(ctx);
      // A card sits square: the sticky note's seeded tilt is dropped, so a board
      // reads as a grid of cards, while the paper's own lift, curl and shadow
      // stay — the card IS a sheet on the desk, drawn by the same pass as a note.
      return { ...geometry, angle: 0, cos: 1, sin: 0 };
    },
    /**
     * The record's key: the paper writing's own raster rung, with the *face's*
     * revision and band folded in.
     *
     * A record is remade when this changes, and the paper's rung only changes at
     * its raster bands (a power-of-two ladder of texels per world unit). The face
     * has crossings of its own — its words move when the document does (a tag
     * added, a link drawn), and its band moves at 56 px and 180 px of the card's
     * width on screen (ADR-0043 §2). Either with the raster rung unchanged would
     * leave the sheet saying what it was last built with: a title row with no
     * body on a card plainly wide enough to read. Three crossings, one key.
     */
    rung: (context) => {
      const rasters = paper.rung?.(context) ?? 0;
      const revision = cardFaceRevisionOf(String(context.props.cardId ?? "")) ?? SUITE_CARD_NO_FACE;
      const band = cardFaceBandIndexOf(context.rect.w * context.zoom);
      return rasters * SUITE_CARD_RUNG_SPAN + revision * SUITE_CARD_BAND_STEPS + band;
    },
    local: (host) => createSuiteCardLocal(paper.local?.(host)),
  };

  const object: DeskObject = defineObject({
    type,
    version: 1,
    props: {
      // The card's text, in the paper kind's own names: its writing rasters
      // `text` (title and body as one flow) at the band the zoom asks for, so a
      // card is written by the GPU exactly like a note — no DOM face, no LOD
      // pop-in. `seeds` is the per-glyph wobble key, empty for a card.
      text: p.string({ default: "" }),
      seeds: p.string({ default: "" }),
      title: p.string({ default: "" }),
      body: p.string({ default: "" }),
      // Which workspace card this object stands for. Empty in the lab, whose
      // objects carry a title/body string instead of a live document.
      cardId: p.string({ default: "" }),
      // The board the card is placed on; scopes the card's presence and menus.
      boardId: p.string({ default: "" }),
      // Read by the reused paper kind for the GPU sheet's colour and edge. `card`
      // is the Suite palette's own entry (the shell's `--surface`/`--ink`), so a
      // card is a document surface while a note stays a yellow sticky.
      paper: p.enum(["card", "yellow"] as const, { default: "card" }),
      pen: p.enum(["card", ...PENS] as const, { default: "card" }),
      seed: p.number({ default: 0 }),
    },
    groups: { face: ["text", "seeds", "title", "body", "cardId", "boardId"] },
    size: SUITE_CARD_SIZE,
    kind,
    // Resizable because the canonical placement stores width/height: ICE's own
    // handles are the resize gesture, and the bridge commits the final snapped
    // box as one position+size write. `snap: "both"` keeps the native guides.
    interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
    provides: [DESK_OBJECT, CONTAINABLE],
    drivers: (host) => {
      const local = host.local as SuiteCardLocal | undefined;
      let attached: SuiteCardOverlayHandle | undefined;
      const driver: SuiteCardDriver = {
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
        // The sheet is the card, EXCEPT above the sharp ceiling: past
        // `2048 / dpr` CSS px of on-screen width ICE's ink raster runs out of
        // resolution and the sheet blurs. There the overlay mounts that card
        // alone (`escalatedOnly`) and draws it in DOM, which is crisp at any
        // size. A comparison renderer or the lab face still takes everything.
        const overlay = createSuiteCardOverlay({
          container: host.container,
          entities: () =>
            rungEntities(host.world, type).map((entity) => entity as unknown as number),
          geometryOf: (entity) => host.geometryOf(entity as Entity) as PaperGeometry | undefined,
          // The widget's own rect, not the paper's drawn extents: `half` carries
          // the hold's lift, so a DOM face sized from it drifts off the object.
          rectOf: (entity) => {
            const position = host.world.read(entity as Entity, Position);
            const size = host.world.read(entity as Entity, Size);
            if (position === undefined || size === undefined) return null;
            return { x: position.x, y: position.y, w: size.w, h: size.h };
          },
          camera: () => host.world.getResource(Camera),
          infoOf: (entity) => faceOf(host.world, entity as Entity, face),
          dpr: () => globalThis.devicePixelRatio,
          ...(slotRenderer !== undefined
            ? { renderer: slotRenderer }
            : SUITE_CARD_DOM_FACE
              ? {}
              : { escalatedOnly: true }),
        });
        overlay.sync();
        (host.driver as SuiteCardDriver | undefined)?.attach(overlay);
      },
    },
  });

  const face = groupOf(object, "face") as Component<SuiteCardFace>;
  return { scale, type, object, face };
}

// The base kind is `suite.card` at rung 1, whatever the ladder's floor is: the
// ladder starts at 0.5 now, and taking its first entry would rename the base
// type (and every id pointing at it) to `suite.card@0.5`.
const BASE_RUNG = createSuiteCardRung(CARD_BASE_SCALE);

/** Every rung, in ladder order — the base one first. */
export const SUITE_CARD_RUNGS: readonly SuiteCardRung[] = [
  BASE_RUNG,
  ...SUITE_TYPE_LADDER.filter((scale) => scale !== CARD_BASE_SCALE).map((scale) =>
    createSuiteCardRung(scale),
  ),
];

/** The base rung's object — the desk registration for `suite.card`. */
export const SuiteCard = BASE_RUNG.object;

/** The base rung's `face` group component. */
export const SUITE_CARD_FACE: Component<SuiteCardFace> = BASE_RUNG.face;

/** The rung a card of this extent takes. */
export function rungForExtent(extent: {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}): SuiteCardRung {
  return rungForScale(scaleForExtent(extent));
}

export function rungForScale(scale: number): SuiteCardRung {
  return SUITE_CARD_RUNGS.find((candidate) => candidate.scale === scale) ?? BASE_RUNG;
}

function groupOf(object: DeskObject, name: string): Component {
  const groups = (object as { groups: readonly { name: string; component: Component }[] }).groups;
  const group = groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.card: no "${name}" group`);
  return group.component;
}

/** Live entities of one rung: our cards are the only widgets carrying its type. */
function rungEntities(world: World, type: string): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === type;
  });
}

function faceOf(
  world: World,
  entity: Entity,
  face: Component<SuiteCardFace>,
): SuiteCardFace | undefined {
  if (!world.isAlive(entity) || !world.has(entity, face)) return undefined;
  const value = world.read(entity, face);
  return { title: value.title, body: value.body, cardId: value.cardId, boardId: value.boardId };
}
