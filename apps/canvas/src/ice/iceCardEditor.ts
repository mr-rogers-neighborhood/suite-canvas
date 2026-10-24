/**
 * The one in-place card editor: when it may open, where it sits, and when its
 * commit lands.
 *
 * ADR-0042 decides the shape: the GPU sheet is the card *read*, and writing
 * happens in exactly one DOM editor mounted over the active card. This module is
 * the framework-free half of that decision — no React, no ICE import — so the
 * gate, the box arithmetic and the commit window can be tested in jsdom and
 * cannot pull the engine into the default bundle.
 *
 * Three facts it owns:
 * - **Where.** The box comes from the entity ICE drew: its frame-local rect plus
 *   the camera of the frame it lives in. Inside an entered Board ICE reports
 *   both in that Board's units, so the same arithmetic glues the editor to the
 *   sheet on the plane and inside a frame.
 * - **Whether.** A viewer, a share whose scope excludes the card, a missing or
 *   trashed card, a whiteboard (which opens its drawing stage instead) and a card
 *   too small to read all refuse. The size gate is the only one about the camera.
 * - **When it commits.** Typing reaches the CRDT through the same Tiptap ↔ Loro
 *   binding the inspector uses, one keystroke at a time; the *canvas* commit —
 *   the projection pass that re-projects the sheet's text and its rung — is
 *   coalesced to one per settle window and flushed when the editor closes
 *   (ADR-0042's "typing is not one commit per keypress").
 */

import { type IceShareScopeInput, withinShareScope } from "./iceShareCaps";
import {
  type SuiteCardCamera,
  type SuiteCardGeometry,
  type SuiteCardRect,
  suiteCardBox,
  suiteCardBoxFromRect,
} from "./suiteCardOverlay";

/** Which editor owns the caret on the card. */
export type IceCardEditingField = "title" | "body";

/**
 * The width at which the editor is offered.
 *
 * A rung's hand is `13 × rung` world units in a `288 × rung` world box, so the
 * body type is ~`screenWidth / 288 × 13` CSS px whatever rung the card settled
 * on: at 320 px that is ~14 px, and at the `full` band's 180 px it is ~8 px —
 * readable as a sheet, not as a place to type. 320 is therefore the gate, and it
 * is always inside the `full` band (ADR-0043 §2's band contract).
 */
export const SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH = 320;

/**
 * How long typing must settle before the canvas re-projects the sheet.
 *
 * One projection pass per window instead of one per keystroke: the sheet is
 * hidden under the editor, so nothing on screen waits for it, and a pass can
 * re-raster (and re-fit the card's rung) — which must not happen mid-word.
 */
export const ICE_CARD_EDITOR_COMMIT_MS = 250;

/** Where the editor sits, in container CSS px, plus the world box it lays out at. */
export interface IceCardEditorBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly scale: number;
  readonly angleDeg: number;
}

/**
 * The editor's box for one frame, or `null` when the card is not on screen.
 *
 * The geometry ICE drew is preferred (it carries the paper's angle), and the
 * canonical widget rect is the fallback: a projected slot can outlive its paper
 * for a tick, and a missing box must not leave an editor stranded over nothing.
 */
export function cardEditorBox(input: {
  readonly geometry?: SuiteCardGeometry | null | undefined;
  readonly rect?: SuiteCardRect | null | undefined;
  readonly camera: SuiteCardCamera | null | undefined;
}): IceCardEditorBox | null {
  const fromGeometry = suiteCardBox(input.geometry, input.camera);
  const box = fromGeometry ?? suiteCardBoxFromRect(input.rect ?? null, input.camera);
  if (box === null) return null;
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    worldWidth: box.worldWidth,
    worldHeight: box.worldHeight,
    scale: box.scale,
    angleDeg: box.angleDeg,
  };
}

/** Is this card big enough on screen to be written in? */
export function mayOfferCardEditor(box: IceCardEditorBox | null): boolean {
  if (box === null) return false;
  return box.width >= SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH;
}

/** Why the canvas refused to open an editor. */
export type IceCardEditorRefusal =
  /** The id names no card in this document (deleted, or a peer's ghost). */
  | "missing-card"
  /** In the trash: readable nowhere, writable nowhere. */
  | "trashed"
  /** A viewer, or a seat without content authority. */
  | "read-only"
  /** The card is outside the share's scope (another board, another card). */
  | "out-of-scope"
  /** A whiteboard card opens its drawing stage, never a text editor. */
  | "whiteboard"
  /** Smaller than `SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH`: read it zoomed in. */
  | "too-small";

export interface IceCardEditorPlan {
  readonly field: IceCardEditingField;
}

export type IceCardEditorDecision =
  | { readonly ok: true; readonly field: IceCardEditingField }
  | { readonly ok: false; readonly reason: IceCardEditorRefusal };

export interface IceCardEditorRequest {
  readonly cardId: string;
  readonly boardId: string;
  /** The card record, or `undefined` when the document does not hold it. */
  readonly card: { readonly deletedAt?: number | null | undefined } | undefined;
  /** Whether this card is a whiteboard, whose double click is its stage. */
  readonly whiteboard: boolean;
  /** The title as the document reads it: an untitled card opens its title. */
  readonly title: string;
  /** `caps.canEditContent` — a viewer of a card share may still read it. */
  readonly canEditContent: boolean;
  /** The session's share, or `null` for the owner. */
  readonly share: IceShareScopeInput | null;
  /**
   * The card's current on-screen width, CSS px — the readable gate. Omitted when
   * the caller cannot measure it (a card the projection has not spawned yet, or
   * the shell's own request for a card it just created): an explicit request is
   * not a gesture on a card the reader can see, so it is not size-gated.
   */
  readonly screenWidth?: number | undefined;
  /** The field the gesture asked for; the title wins on an untitled card. */
  readonly field?: IceCardEditingField | undefined;
}

/**
 * The one gate every opening path goes through: double click, Enter, and the
 * card the shell just created. The order matters for the message a caller can
 * report — a missing card is not a permission problem.
 *
 * The readable-width gate is the one *gesture* rule here: it applies whenever the
 * caller can measure the card, and is skipped when it cannot (a card the
 * projection has not spawned yet, or a card the shell asked for by name). A
 * brand-new card at fit zoom is 288 world units wide and would fail the gate,
 * yet its title is exactly what the reader asked for by creating it.
 */
export function planCardEditor(request: IceCardEditorRequest): IceCardEditorDecision {
  const { cardId, boardId, card, whiteboard, canEditContent, share } = request;
  if (card === undefined) return { ok: false, reason: "missing-card" };
  if (card.deletedAt !== undefined && card.deletedAt !== null) {
    return { ok: false, reason: "trashed" };
  }
  if (!canEditContent) return { ok: false, reason: "read-only" };
  if (!withinShareScope({ boardId, cardId }, share)) return { ok: false, reason: "out-of-scope" };
  if (whiteboard) return { ok: false, reason: "whiteboard" };
  if (
    request.screenWidth !== undefined &&
    !(request.screenWidth >= SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH)
  ) {
    return { ok: false, reason: "too-small" };
  }
  const untitled = request.title.trim().length === 0;
  return { ok: true, field: untitled ? "title" : (request.field ?? "body") };
}

/**
 * The card the canvas editor is open on, read from the UI store's one editing
 * protocol.
 *
 * `editingSurface` is what makes "one editor" structural: the inspector's panel
 * and the focus surface name their own surface, so a panel session can never be
 * mistaken for the canvas one, and the canvas one can never run beside them.
 */
export function activeCardEditor(ui: {
  readonly editingNodeId: string | null;
  readonly editingField: IceCardEditingField;
  readonly editingSurface: "canvas" | "panel" | "focus";
  readonly canEditContent: boolean;
}): { readonly cardId: string; readonly field: IceCardEditingField } | null {
  if (!ui.canEditContent) return null;
  if (ui.editingSurface !== "canvas") return null;
  const cardId = ui.editingNodeId;
  if (cardId === null || cardId.trim().length === 0) return null;
  return { cardId, field: ui.editingField };
}

/** A coalescing commit: `touch()` per keystroke, one `commit()` per window. */
export interface IceTextCommitBarrier {
  /** Note local typing; the commit lands `delayMs` after the last call. */
  touch(): void;
  /** Run a pending commit now. Idle is a no-op, so close can always flush. */
  flush(): void;
  /** Drop a pending commit without running it (the card left the document). */
  cancel(): void;
  /** Whether a commit is scheduled. */
  readonly pending: boolean;
}

/**
 * The commit window. It is a plain timer so a test can drive it with fake clocks;
 * `commit` is read at fire time, never captured at creation, so the caller can
 * point it at the live projection.
 */
export function createTextCommitBarrier(input: {
  readonly commit: () => void;
  readonly delayMs?: number | undefined;
  readonly setTimer?: ((run: () => void, ms: number) => number) | undefined;
  readonly clearTimer?: ((handle: number) => void) | undefined;
}): IceTextCommitBarrier {
  const delay = input.delayMs ?? ICE_CARD_EDITOR_COMMIT_MS;
  const setTimer =
    input.setTimer ??
    ((run: () => void, ms: number) => globalThis.setTimeout(run, ms) as unknown as number);
  const clearTimer =
    input.clearTimer ?? ((handle: number) => globalThis.clearTimeout(handle as unknown as number));
  let handle: number | null = null;

  const clear = (): void => {
    if (handle === null) return;
    clearTimer(handle);
    handle = null;
  };

  return {
    touch: () => {
      clear();
      handle = setTimer(() => {
        handle = null;
        input.commit();
      }, delay);
    },
    flush: () => {
      if (handle === null) return;
      clear();
      input.commit();
    },
    cancel: clear,
    get pending() {
      return handle !== null;
    },
  };
}

/** What the desk answers for a container-relative point. */
export interface IceCardEditorTarget {
  readonly cardId: string;
  readonly boardId: string;
}

/**
 * Everything the openers ask the surface. Kept structural so the wiring can be
 * driven from a jsdom test with a stub desk and a stub document.
 */
export interface IceCardEditorOpeners {
  /** What the desk picks at a container-relative point, or `null`. */
  cardAt(point: { readonly x: number; readonly y: number }): IceCardEditorTarget | null;
  /** The one selected card, or `null` when the selection is not exactly one card. */
  selectedCard(): IceCardEditorTarget | null;
  /** The gate (`planCardEditor`) for a target. */
  plan(target: IceCardEditorTarget, field?: IceCardEditingField): IceCardEditorDecision;
  /** Whether an editor is already open; a press inside it belongs to the text. */
  isEditing(): boolean;
  /** The mounted editor element, so a press inside it never re-opens the card. */
  editorElement(): HTMLElement | null;
  /** Ask the one owner of editing state (the UI store) to open the card. */
  open(target: IceCardEditorTarget, field: IceCardEditingField): void;
}

/** Is this event aimed at something that is already taking text? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // `isContentEditable` is the live fact; the attribute is what the DOM says
  // before layout (and in a jsdom test, where the property is not implemented).
  if (target.isContentEditable === true) return true;
  const editable = target.getAttribute("contenteditable");
  return editable === "" || editable === "true" || editable === "plaintext-only";
}

/** Is this event inside the open editor (its own presses and keys)? */
export function insideCardEditor(target: EventTarget | null, editor: HTMLElement | null): boolean {
  if (editor === null || target === null) return false;
  return typeof (target as Node).nodeType === "number" && editor.contains(target as Node);
}

/**
 * The three opening gestures, in one place:
 *
 * - **double click** a card — the gesture the flow surface used for the in-place
 *   editor, and the only one that can say *where* on the card the reader aimed;
 * - **Enter** with exactly one card selected — the keyboard's way in;
 * - a card the shell creates names itself through `startEditing`, which is the
 *   store's job, not this module's.
 *
 * The listeners are capture-phase for Enter because ICE's own keymap binds the
 * same key (it lifts or enters the selected object); opening the editor is the
 * parity answer (roadmap §9), so this handler claims the key first and lets
 * everything else through untouched.
 */
export function attachCardEditorOpeners(
  input: {
    readonly root: HTMLElement;
    readonly keyTarget?: EventTarget | undefined;
  },
  openers: IceCardEditorOpeners,
): () => void {
  const doc = input.root.ownerDocument;
  const keyTarget = input.keyTarget ?? doc.defaultView ?? input.root;

  const aim = (event: MouseEvent): void => {
    if (insideCardEditor(event.target, openers.editorElement())) return;
    const bounds = input.root.getBoundingClientRect();
    const target = openers.cardAt({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
    if (target === null) return;
    const decision = openers.plan(target);
    if (!decision.ok) return;
    openers.open(target, decision.field);
  };

  /**
   * Keys that belong to the desk: nothing focused, the window or the document
   * itself, the page body, or anything inside the surface. A dialog's button,
   * the library's search field and the inspector's inputs are none of those, and
   * they own their own Enter.
   */
  const aimedAtDesk = (target: EventTarget | null): boolean => {
    if (target === null) return true;
    if (!(target instanceof Node)) return true;
    if (target === doc || target === doc.body) return true;
    return input.root.contains(target);
  };

  const onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.key !== "Enter" || key.metaKey || key.ctrlKey || key.altKey || key.shiftKey) return;
    if (key.defaultPrevented) return;
    if (isTypingTarget(key.target)) return;
    // Only keys aimed at the desk: a dialog's button, the library's search box or
    // the inspector's fields own their own Enter. The body is the desk's too,
    // because nothing else has focus then.
    if (!aimedAtDesk(key.target)) return;
    if (insideCardEditor(key.target, openers.editorElement())) return;
    if (openers.isEditing()) return;
    const target = openers.selectedCard();
    if (target === null) return;
    const decision = openers.plan(target);
    if (!decision.ok) return;
    // The one place the keymap is intercepted: ICE binds Enter to lift, and a
    // card's Enter is "write in it". Nothing else about Enter changes.
    key.preventDefault();
    key.stopPropagation();
    openers.open(target, decision.field);
  };

  input.root.addEventListener("dblclick", aim);
  keyTarget.addEventListener("keydown", onKeyDown, true);
  return () => {
    input.root.removeEventListener("dblclick", aim);
    keyTarget.removeEventListener("keydown", onKeyDown, true);
  };
}
