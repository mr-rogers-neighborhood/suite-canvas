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
 *   `SceneCardView`/`NodeCard` shell for the live card named by this object's
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
  createSuiteCardOverlay,
  type SuiteCardFace,
  type SuiteCardOverlayHandle,
  type SuiteCardSlotRenderer,
} from "./suiteCardOverlay";
import { SUITE_CARD_DOM_FACE, SUITE_CARD_HAND, SUITE_FACE } from "./suitePen";

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

/** Our kind's per-desk state: the overlay's frame hook. */
interface SuiteCardLocal extends KindLocal {
  setSink(sink: (() => void) | undefined): void;
}

function createSuiteCardLocal(base: KindLocal | undefined): SuiteCardLocal {
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

/**
 * What the DOM half needs of the kind's driver: a place to hang the overlay's
 * sync. The driver itself follows nothing (idle always true), so it never keeps
 * the desk awake.
 */
interface SuiteCardDriver extends KindDriver {
  attach(overlay: SuiteCardOverlayHandle): void;
}

const paper = paperKind({ hand: { law: SUITE_CARD_HAND, face: SUITE_FACE, bleed: 0 } });

const suiteCardKind: PaperKindOf = {
  ...paper,
  name: SUITE_CARD_KIND,
  resolve(ctx) {
    const geometry = paper.resolve(ctx);
    // A card sits square: the sticky note's seeded tilt is dropped, so a board
    // reads as a grid of cards, while the paper's own lift, curl and shadow stay
    // — the card IS a sheet on the desk, drawn by the same pass as a note.
    return { ...geometry, angle: 0, cos: 1, sin: 0 };
  },
  local: (host) => createSuiteCardLocal(paper.local?.(host)),
};

export const SuiteCard = defineObject({
  type: SUITE_CARD_TYPE,
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
  kind: suiteCardKind,
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
      // The sheet is the card. A DOM overlay is only mounted when something
      // asks for one (the comparison renderer, or the lab's default face);
      // mounting it beside the GPU text would paint a second card on top of the
      // first, which is exactly the "old text over the new" seam.
      if (!SUITE_CARD_DOM_FACE && slotRenderer === undefined) return;
      const overlay = createSuiteCardOverlay({
        container: host.container,
        entities: () => suiteCardEntities(host.world).map((entity) => entity as unknown as number),
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
        infoOf: (entity) => faceOf(host.world, entity as Entity),
        ...(slotRenderer !== undefined ? { renderer: slotRenderer } : {}),
      });
      overlay.sync();
      (host.driver as SuiteCardDriver | undefined)?.attach(overlay);
    },
  },
});

/** The `face` group's component — title/body read without a second registry. */
export const SUITE_CARD_FACE = groupOf("face") as Component<SuiteCardFace>;

function groupOf(name: string): Component {
  const group = SuiteCard.groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.card: no "${name}" group`);
  return group.component;
}

function suiteCardEntities(world: World): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === SUITE_CARD_TYPE;
  });
}

function faceOf(world: World, entity: Entity): SuiteCardFace | undefined {
  if (!world.isAlive(entity) || !world.has(entity, SUITE_CARD_FACE)) return undefined;
  const face = world.read(entity, SUITE_CARD_FACE);
  return { title: face.title, body: face.body, cardId: face.cardId, boardId: face.boardId };
}
