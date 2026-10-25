/**
 * Copy, cut, paste and duplicate — the clipboard the desk keeps in the document,
 * not in the OS.
 *
 * A card's title and body live in Loro container trees. The DOM clipboard cannot
 * carry them: reading them back out would mean re-typing text into a rich
 * document (and losing marks, mentions and images), and the browser's clipboard
 * is a shared, permissioned surface that a canvas should not depend on. So the
 * buffer is **card ids and positions**, and a paste asks the document to copy its
 * own trees: `duplicateCard` is the one canonical operation that writes a copy
 * *with* its content — a batch of `createCard` writes would create empty cards.
 *
 * The OS clipboard still gets the titles, as plain text, because a courtesy costs
 * one `writeText` and means "paste" into a chat window does something sensible.
 * It is never read back: nothing this canvas does depends on it.
 *
 * ## One gesture, one commit
 *
 * A paste of five cards is one history step: the applier opens one
 * `doc.batch(...)` and clones every card inside it, then moves them to their
 * final points. `duplicateCard` opens a batch of its own, which joins the
 * outer one, so undo removes the whole paste rather than a card at a time.
 *
 * ## Coordinates
 *
 * Copied cards remember the position they had **on their own board**. A paste
 * re-bases the group on its top-left corner (`anchor`), so the arrangement of a
 * multi-selection survives the trip, and drops it wherever the pointer is — on
 * the Board the pointer is over, in that Board's own units.
 *
 * Everything here is pure: no engine, no React, no document. The gesture hook
 * supplies the ids, the positions and the capability row, and performs the write
 * through `applyClone`.
 */

import {
  ICE_COORDINATE_PRECISION,
  ICE_WRITE_ORIGIN,
  type IceCapabilities,
  type IceRefusedPlan,
} from "./iceBridge";

/** Default offset of a duplicate from its source: down-right, like a paper copy. */
export const ICE_DUPLICATE_OFFSET = { x: 24, y: 24 } as const;

/** One card as it was copied: its identity, its Board, and where it sat there. */
export interface IceClipboardCard {
  readonly cardId: string;
  readonly boardId: string;
  /** Position on `boardId` at copy time. */
  readonly x: number;
  readonly y: number;
  /** Copy-time title. Only ever used for the OS clipboard courtesy. */
  readonly title: string;
}

export interface IceClipboard {
  readonly cards: readonly IceClipboardCard[];
  /** Top-left of the copied group; paste offsets are measured from here. */
  readonly anchor: { readonly x: number; readonly y: number };
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function round(value: number): number {
  return Math.round(value * ICE_COORDINATE_PRECISION) / ICE_COORDINATE_PRECISION;
}

/**
 * The buffer for a selection. One entry per card (a card painted in two frames
 * is still one card), non-finite boxes dropped, `null` when nothing is left —
 * which is what "copy" of an empty selection should do: leave the buffer alone.
 */
export function buildClipboard(cards: readonly IceClipboardCard[]): IceClipboard | null {
  const seen = new Map<string, IceClipboardCard>();
  for (const card of cards) {
    if (!finite(card.x) || !finite(card.y)) continue;
    if (!seen.has(card.cardId)) seen.set(card.cardId, card);
  }
  const kept = [...seen.values()];
  if (kept.length === 0) return null;
  const anchor = {
    x: Math.min(...kept.map((card) => card.x)),
    y: Math.min(...kept.map((card) => card.y)),
  };
  return { cards: kept, anchor };
}

/** The titles, as the one line the OS clipboard receives. */
export function clipboardText(clipboard: IceClipboard): string {
  return clipboard.cards.map((card) => card.title).join("\n");
}

/**
 * Copy: the buffer a seat may have.
 *
 * Copying is a read, but the only thing a buffer is for is a paste, and the
 * seat that cannot create cards cannot paste. A viewer therefore copies nothing
 * — an empty clipboard is a truthful answer to "this seat may not do that",
 * where a full one would promise an action that will be refused later.
 */
export function planCopy(input: {
  readonly cards: readonly IceClipboardCard[];
  readonly capabilities: IceCapabilities;
}): IceClipboard | null {
  if (!input.capabilities.write) return null;
  return buildClipboard(input.cards);
}

/**
 * The surface's buffer.
 *
 * Module-level on purpose: there is one canvas per page and the buffer is UI
 * state (the same lifetime as the tab), not document data — a reload empties it,
 * which is what a reader expects of copy/paste. It holds ids, never text, so a
 * peer's edit between copy and paste is what gets pasted.
 */
let buffer: IceClipboard | null = null;

export function setIceClipboard(next: IceClipboard | null): void {
  buffer = next;
}

export function getIceClipboard(): IceClipboard | null {
  return buffer;
}

/** One card to create from a copy: where the clone goes, and what it copies. */
export interface IceCloneTarget {
  readonly sourceCardId: string;
  readonly boardId: string;
  readonly x: number;
  readonly y: number;
}

/** A paste or a duplicate: one commit that clones every card in the list. */
export interface IceCloneWrite {
  readonly kind: "cloneCards";
  readonly cards: readonly IceCloneTarget[];
}

export type IceClonePlan =
  | { readonly status: "commit"; readonly write: IceCloneWrite }
  | IceRefusedPlan;

function denied(): IceClonePlan {
  return { status: "denied", reason: "read-only" };
}

function empty(): IceClonePlan {
  return { status: "skip", reason: "empty-selection" };
}

/**
 * Paste: the copied group, re-based on `target` and placed on `target.boardId`.
 *
 * `target` is the point under the pointer **in the target Board's units** — the
 * caller has already resolved which Board that is (a mat under the pointer, or
 * the frame the camera is inside) and converted the screen point.
 */
export function planPaste(input: {
  readonly clipboard: IceClipboard;
  readonly target: { readonly boardId: string; readonly x: number; readonly y: number };
  readonly capabilities: IceCapabilities;
}): IceClonePlan {
  if (!input.capabilities.write) return denied();
  const { clipboard, target } = input;
  if (clipboard.cards.length === 0) return empty();
  if (!finite(target.x) || !finite(target.y) || target.boardId.trim().length === 0) {
    return { status: "skip", reason: "invalid-transform" };
  }
  return {
    status: "commit",
    write: {
      kind: "cloneCards",
      cards: clipboard.cards.map((card) => ({
        sourceCardId: card.cardId,
        boardId: target.boardId,
        x: round(target.x + (card.x - clipboard.anchor.x)),
        y: round(target.y + (card.y - clipboard.anchor.y)),
      })),
    },
  };
}

/**
 * Duplicate: every card copied onto the Board it already lives on, offset by a
 * paper copy's distance from **its own** position — so a multi-selection keeps
 * its shape and a card inside a Board stays inside it.
 */
export function planDuplicate(input: {
  readonly cards: readonly IceClipboardCard[];
  readonly capabilities: IceCapabilities;
  readonly offset?: { readonly x: number; readonly y: number } | undefined;
}): IceClonePlan {
  if (!input.capabilities.write) return denied();
  if (input.cards.length === 0) return empty();
  const offset = input.offset ?? ICE_DUPLICATE_OFFSET;
  const seen = new Set<string>();
  const cards: IceCloneTarget[] = [];
  for (const card of input.cards) {
    if (seen.has(card.cardId)) continue;
    if (!finite(card.x) || !finite(card.y)) continue;
    seen.add(card.cardId);
    cards.push({
      sourceCardId: card.cardId,
      boardId: card.boardId,
      x: round(card.x + offset.x),
      y: round(card.y + offset.y),
    });
  }
  if (cards.length === 0) return { status: "skip", reason: "invalid-transform" };
  return { status: "commit", write: { kind: "cloneCards", cards } };
}

/**
 * The document operations a clone needs. `cloneCard` must create a copy *with
 * its content* and return the new id; `batch` joins the whole paste into one
 * history step. `workspaceCloneWriter` below is the reference adapter.
 */
export interface IceCloneWriter {
  cloneCard(
    sourceCardId: string,
    target: { readonly boardId: string; readonly x: number; readonly y: number },
  ): string | null;
  batch<T>(origin: string, fn: () => T): T;
}

/** The card ids a clone created, in order. A source that could not be copied is skipped. */
export function applyClone(
  writer: IceCloneWriter,
  write: IceCloneWrite,
  origin: string = `${ICE_WRITE_ORIGIN}:clone`,
): string[] {
  return writer.batch(origin, () => {
    const created: string[] = [];
    for (const card of write.cards) {
      const id = writer.cloneCard(card.sourceCardId, {
        boardId: card.boardId,
        x: card.x,
        y: card.y,
      });
      if (id !== null) created.push(id);
    }
    return created;
  });
}

/**
 * The slice of `WorkspaceDocument` the reference clone writer uses. Declared
 * structurally, like the bridge's own writer, so this module stays free of the
 * document at runtime.
 */
export interface WorkspaceCloneDocument {
  duplicateCard(
    cardId: string,
    options?: { readonly boardId?: string; readonly offset?: { x: number; y: number } },
  ): { readonly id: string };
  movePlacements(boardId: string, moves: readonly { cardId: string; x: number; y: number }[]): void;
  batch<T>(origin: string, fn: () => T): T;
}

/**
 * The reference writer: copy the card's trees, then place it where the clone
 * asked. `duplicateCard` already places it (at the source's position plus an
 * offset); the follow-up move is what makes the destination exact, and it lands
 * in the same batch, so the intermediate position is never observable.
 *
 * A source the document refuses (trashed, deleted by a peer, never existed) is
 * reported as `null` rather than aborting the batch: pasting four of five cards
 * is better than pasting none, and the missing one was gone anyway.
 */
export function workspaceCloneWriter(doc: WorkspaceCloneDocument): IceCloneWriter {
  return {
    cloneCard(sourceCardId, target) {
      try {
        const copy = doc.duplicateCard(sourceCardId, { boardId: target.boardId });
        doc.movePlacements(target.boardId, [{ cardId: copy.id, x: target.x, y: target.y }]);
        return copy.id;
      } catch {
        return null;
      }
    },
    batch(origin, fn) {
      return doc.batch(origin, fn);
    },
  };
}
