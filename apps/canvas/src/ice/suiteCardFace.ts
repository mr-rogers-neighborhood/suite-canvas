/**
 * What a card's paper says, and what each band draws of it (ADR-0043 §2).
 *
 * One raster per card, one face per raster: the paper pass takes a single text
 * flow for the whole sheet, and `HandLayout` has no per-glyph face, so chrome
 * cannot be mixed into the writing. The flow is therefore the *whole* face —
 * the title row, a blank line, then the body — and the **band** decides how
 * much of it is written:
 *
 * - `icon` (< 56 px of the card's own width on screen) writes nothing;
 * - `compact` (56–179 px) writes the title row alone;
 * - `full` (≥ 180 px) writes the title row and the body.
 *
 * That is the whole contract, and it is why this module is pure: the projection
 * builds one string per card, the `suite.card` kind truncates it at the band its
 * own rect and the camera's zoom ask for, and both read the same two rules.
 *
 * The title row is `glyph · title · ⇄n · #n` — the type's glyph, the card's
 * title, the number of cards it is connected to (the inspector's own figure:
 * `referenceCount`) and its tag count. A count of zero is omitted, because the
 * row is ~40 characters wide at the reference card and a `⇄0` spends four of
 * them saying nothing. Tag *names*, property chips and a `⋮` menu are the
 * inspector's, never the face's.
 *
 * A whiteboard has one extra slot, its stroke count (`✎ n`), because a drawing
 * is content and a count is the honest interim until the textured face exists
 * (ADR-0043 §3; `suiteWhiteboardFace.ts` states what is deferred).
 */

import type { CardType, WorkspaceDocument } from "@suite/graph";

import { resolveCardType } from "../cards/cardTypes";
import { isWhiteboardCard } from "../cards/whiteboard";
import { type SuiteCardBand, suiteCardBand } from "./suiteCardOverlay";
import {
  EMPTY_WHITEBOARD_FACE,
  type WhiteboardFace,
  whiteboardSketchBody,
} from "./suiteWhiteboardFace";

/** What separates the title row's items: one space, a dot, one space. */
export const CARD_FACE_SEPARATOR = " · ";

/** The mark a reference count carries; the inspector calls the same number "links". */
export const CARD_FACE_REFERENCES_MARK = "⇄";

/** The mark a tag count carries. */
export const CARD_FACE_TAGS_MARK = "#";

/** The mark a whiteboard's stroke count carries. */
export const CARD_FACE_STROKES_MARK = "✎";

/** What the face falls back to when a card has neither a title nor a body. */
export const CARD_FACE_UNTITLED = "Untitled";

/**
 * Everything a card's face is made of, read from the document by the projection.
 * Band-independent on purpose: the band is a property of *how big* the card is
 * on screen, not of what it says.
 */
export interface SuiteCardFaceContent {
  /** The primary type's glyph — one character (ADR-0043 §2's table). */
  readonly glyph: string;
  /** The card's display title, or its type's name when it has none. */
  readonly title: string;
  /** Distinct cards this one is connected to (`referenceCount`), omitted at 0. */
  readonly references: number;
  /** How many tags the card carries, omitted at 0. */
  readonly tags: number;
  /** A whiteboard's live stroke count, omitted at 0 and for every other card. */
  readonly strokes?: number | undefined;
  /** The body, already trimmed: empty for a card that has none, and for a whiteboard. */
  readonly body: string;
}

/**
 * The card's title as the face says it: the display title, or the type's name
 * when the card has neither a title nor a body of its own.
 *
 * `displayTitle` answers `"Untitled"` for a card with no text at all — a
 * whiteboard, whose only content is its drawing — and a card that says
 * "Untitled" on the desk says less than one that names its type.
 */
export function cardFaceTitle(displayTitle: string, typeName: string): string {
  const title = displayTitle.trim();
  const fallback = typeName.trim();
  if (title === "" || title === CARD_FACE_UNTITLED)
    return fallback === "" ? CARD_FACE_UNTITLED : fallback;
  return title;
}

/** A count as the face draws it: nothing at zero, `0` is not worth four characters. */
function countItem(mark: string, value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${mark}${Math.round(value)}`;
}

/**
 * The title row: `glyph · title · ⇄n · ✎n · #n`, every empty item dropped.
 *
 * The glyph leads because it is the only type cue the face has (ADR-0040
 * withdrew the type graph, not the type); the counts follow the title so a
 * reader's eye lands on the name first.
 */
export function cardFaceTitleRow(content: SuiteCardFaceContent): string {
  const parts: string[] = [];
  const glyph = content.glyph.trim();
  if (glyph !== "") parts.push(glyph);
  const title = content.title.trim();
  if (title !== "") parts.push(title);
  const strokes =
    content.strokes === undefined ? null : countItem(CARD_FACE_STROKES_MARK, content.strokes);
  if (strokes !== null) parts.push(strokes);
  const references = countItem(CARD_FACE_REFERENCES_MARK, content.references);
  if (references !== null) parts.push(references);
  const tags = countItem(CARD_FACE_TAGS_MARK, content.tags);
  if (tags !== null) parts.push(tags);
  return parts.join(CARD_FACE_SEPARATOR);
}

/**
 * The whole flow the paper is handed: the title row, a blank line, the body.
 *
 * The blank line is the paragraph break the flow era's face drew between a
 * card's title and its writing, and it is what makes the body a body rather than
 * a continuation of the row.
 */
export function cardFaceFlow(content: SuiteCardFaceContent): string {
  const row = cardFaceTitleRow(content);
  const body = content.body.trim();
  if (body === "") return row;
  return row === "" ? body : `${row}\n\n${body}`;
}

/**
 * What a band draws of the flow.
 *
 * `compact` keeps the first line — the title row is the flow's first line by
 * construction, so "the title row only" needs no marker in the string and no
 * second field on the widget.
 */
export function cardFaceAtBand(flow: string, band: SuiteCardBand): string {
  if (band === "icon") return "";
  if (band === "full") return flow;
  const [first = ""] = flow.split("\n");
  return first;
}

/** The band a card of this on-screen width draws. One definition, in the overlay. */
export function cardFaceBand(screenWidth: number): SuiteCardBand {
  return suiteCardBand(screenWidth);
}

/**
 * Where a card's face material comes from. The projection hands the live
 * document and its own per-pass caches; a test hands a document and a constant,
 * which is why the composition is a function of sources rather than of a hook.
 */
export interface CardFaceSources {
  readonly workspace: WorkspaceDocument;
  readonly types: Map<string, CardType>;
  /** Distinct cards this one connects to — the inspector's `referenceCount`. */
  referencesOf(cardId: string): number;
  /** A whiteboard's scene, or `null` for every other card. */
  drawingOf(cardId: string): WhiteboardFace | null;
}

/**
 * What a card says, read from the document.
 *
 * A whiteboard has no text of its own — its content *is* the drawing — so its
 * body is the sketch of its strokes and its title row carries the stroke count.
 * Every other card's body is its rich text, trimmed: the face stops at the
 * characters, and the marks (bold, links, mentions) are the editor's and the
 * inspector's (ADR-0043 §1).
 */
export function cardFaceFrom(sources: CardFaceSources, cardId: string): string {
  const { workspace } = sources;
  const card = workspace.getCard(cardId);
  const type = resolveCardType(sources.types, card?.primaryTypeId ?? "");
  const whiteboard = card !== undefined && isWhiteboardCard(card);
  const drawing = whiteboard ? (sources.drawingOf(cardId) ?? EMPTY_WHITEBOARD_FACE) : null;
  const body = whiteboard
    ? whiteboardSketchBody(drawing ?? EMPTY_WHITEBOARD_FACE)
    : workspace.cardText(cardId).trim();
  const strokes = drawing === null ? 0 : drawing.strokes;
  return cardFaceFlow({
    glyph: type.glyph,
    title: cardFaceTitle(workspace.displayTitle(cardId), type.name),
    references: sources.referencesOf(cardId),
    tags: card?.tags.length ?? 0,
    ...(strokes > 0 ? { strokes } : {}),
    body,
  });
}

/**
 * The faces the projection last built — the *published* face.
 *
 * Why a registry and not the widget's `text` prop: the boot spawns every card
 * before the projection exists and fills that prop with its own composition, so
 * a projection that wanted the prop to be the face would have to replace every
 * seeded entity at boot. A replace is a new entity id, and the presence layer,
 * the link gesture and the selection all hold the old one (measured: a card
 * hovered perfectly and offered no link dots). Publishing costs a Map per
 * reconcile pass and nothing per frame; the kind reads it at draw time, and the
 * dev snapshot (`iceDebug.ts`) reads the same map so the lab can assert what a
 * card says without reading a rendering API.
 */
let publishedFaces: ReadonlyMap<string, string> = new Map();

/** Publish this reconcile's flows. Called once per pass, never per frame. */
export function publishCardFaces(faces: ReadonlyMap<string, string>): void {
  publishedFaces = faces;
}

/**
 * A small, stable hash of a flow: the *revision* the sheet rebuilds on.
 *
 * The face is not a prop the boot can write (the seed spawns a card before the
 * projection exists, and replacing every seeded entity to change four words
 * costs every id the presence layer, the link gesture and the selection hold).
 * It lives here instead, and the kind folds this number into the record's rung:
 * when the words change, the rung changes, and the paper is written again.
 */
export function cardFaceRevision(flow: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < flow.length; index += 1) {
    hash ^= flow.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // 16 bits is plenty for a change key and keeps the rung a small number.
  return (hash >>> 16) & 0xffff;
}

/** The revision of the flow the projection last published for a card. */
export function cardFaceRevisionOf(cardId: string): number | undefined {
  const text = publishedFaces.get(cardId);
  return text === undefined ? undefined : cardFaceRevision(text);
}

/** What the projection last wrote for a card, or `undefined` before a reconcile. */
export function cardFaceOf(cardId: string): string | undefined {
  return publishedFaces.get(cardId);
}

/** The band a card's sheet drew at, and the width that decided it — the drawn truth. */
export interface DrawnFaceBand {
  readonly band: SuiteCardBand;
  /** The card's width on screen, CSS px, as the kind measured it. */
  readonly width: number;
}

const drawnBands = new Map<string, DrawnFaceBand>();

/**
 * What a card's sheet wrote this frame: its band and the width behind it.
 *
 * Published from the kind, because the band is only known where the sheet is
 * drawn — the projection cannot see the camera. The dev snapshot reads it, so
 * `scripts/ice-scenarios/face.mjs` can assert the band the *sheet* used rather
 * than one derived from geometry beside it.
 */
export function publishCardFaceBand(cardId: string, band: SuiteCardBand, width: number): void {
  if (!import.meta.env.DEV || cardId === "") return;
  const known = drawnBands.get(cardId);
  const rounded = Number(width.toFixed(2));
  if (known !== undefined && known.band === band && known.width === rounded) return;
  drawnBands.set(cardId, { band, width: rounded });
}

/** The band a card last drew at, or `undefined` before its first frame. */
export function cardFaceBandOf(cardId: string): DrawnFaceBand | undefined {
  return drawnBands.get(cardId);
}
