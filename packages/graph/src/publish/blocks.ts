/**
 * Owns body-block identity: the structural key a block carries, the alignment
 * of a draft or workspace body against the baseline, and the degrade rule that
 * turns "these blocks no longer line up" into one whole-body conflict.
 *
 * It must never decide whether a change is publishable and must never write a
 * block. Alignment is a pure read, and the conservative answer (no match) is
 * the only guess it may make: a pairing invented here silently loses text.
 */

import type { LoroMap } from "loro-crdt";
import type { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import {
  canonical,
  isList,
  isMap,
  isTextSnapshot,
  type RichTextSnapshot,
  snapshotValue,
} from "./snapshot.js";

/** Where one block of a card body lives, so apply can find it again. */
export interface BlockTarget {
  /**
   * Structural key of the block in the baseline body. The source still holds
   * that block while only the draft changed it, so the key is the reliable
   * lookup; the fields below are the conservative fallback.
   */
  key: string;
  /** Position in the baseline body; used only when `key` no longer resolves. */
  index: number;
  /** Node name, so the index fallback never rewrites a different block kind. */
  nodeName: string;
  /** Structural key of the preceding block, for an insertion anchor. */
  after: string | null;
}

/**
 * One top-level block of a card body (a direct child of the ProseMirror `doc`),
 * identified well enough to tell "the same block" from "another block" across
 * the draft, the baseline and the workspace.
 */
export interface BodyBlock {
  /** Loro container id, when the body exposes one. */
  id: string | null;
  nodeName: string;
  /** The block's subtree, as a snapshot; writing it rewrites only this block. */
  tree: RichTextSnapshot;
  /** Plain text of the block, for conflict labels. */
  text: string;
  /**
   * Structural key, unique inside one body: node name, a hash of the block's
   * subtree and the occurrence of that same content. It is content-addressed
   * rather than positional on purpose: a block inserted above shifts positions
   * but not keys, a duplicated block still gets its own key, and a changed
   * block simply has no key match, which is how an edit is told from a move.
   */
  key: string;
}

/** FNV-1a, twice with different offsets, as a short stable digest. */
function digest(value: string): string {
  let forward = 0x811c9dc5;
  let backward = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    forward ^= value.charCodeAt(index);
    forward = Math.imul(forward, 0x01000193) >>> 0;
    backward ^= value.charCodeAt(value.length - 1 - index);
    backward = Math.imul(backward, 0x01000193) >>> 0;
  }
  return `${forward.toString(36)}${backward.toString(36)}`;
}

/** Every insert of a subtree, joined; enough to show a conflict label. */
function blockText(value: RichTextSnapshot): string {
  if (isTextSnapshot(value)) {
    return value.$text.map((op) => (typeof op.insert === "string" ? op.insert : "")).join("");
  }
  if (Array.isArray(value)) return value.map(blockText).join(" ").trim();
  if (value !== null && typeof value === "object") {
    return Object.values(value).map(blockText).join(" ").trim();
  }
  return "";
}

/**
 * The blocks of a card body, in document order.
 *
 * A block's identity is, in order of preference: its Loro container id (which
 * survives a fork or a baseline snapshot of the same document), then the
 * structural key. The structural key is the conservative fallback the merge
 * relies on when two projections hold copies of the same block in different
 * containers: it never guesses, so a block inserted above shifts positions but
 * not keys, and a block whose content changed simply has no key match — the
 * caller pairs those by position only when the counts and node names agree.
 */
export function readBodyBlocks(workspace: WorkspaceDocument, cardId: string): BodyBlock[] {
  const root = workspace.peekContent(cardId);
  if (!root) return [];
  const children = root.get("children");
  if (!isList(children)) return [];
  const blocks: BodyBlock[] = [];
  const occurrences = new Map<string, number>();
  for (const value of children.toArray()) {
    const nodeName = isMap(value) ? nodeNameOf(value) : "text";
    const tree = snapshotValue(value);
    const stem = `${nodeName}:${digest(canonical(tree))}`;
    const occurrence = occurrences.get(stem) ?? 0;
    occurrences.set(stem, occurrence + 1);
    blocks.push({
      id: isMap(value) ? String(value.id) : null,
      nodeName,
      tree,
      text: blockText(tree),
      key: `${stem}:${occurrence}`,
    });
  }
  return blocks;
}

function nodeNameOf(map: LoroMap): string {
  const name = map.get("nodeName");
  return typeof name === "string" && name.length > 0 ? name : "block";
}

export interface BlockAlignment {
  /** Baseline index → the other body's index, or -1 when it is gone. */
  matches: number[];
  /** Other-body indices with no baseline counterpart. */
  added: number[];
  /**
   * True when matched blocks come back in a different order. Content moved, and
   * no per-block write can express that, so the caller degrades.
   */
  reordered: boolean;
}

/**
 * Aligns one body against the baseline, in three passes:
 *
 * 1. Loro node id, but only when at least one id is shared. Two documents in
 *    the same lineage (a draft and the baseline taken from it) share container
 *    ids; a projection copied into a fresh document does not, and pairing by id
 *    there would report every block as removed and re-added.
 * 2. The structural key, which is the normal path between projections.
 * 3. Position, only for the leftovers of both sides at once, and only when the
 *    counts and the node names agree. That is what makes "the same paragraph,
 *    edited" one key instead of a removal plus an addition.
 */
export function alignBlocks(
  baseline: readonly BodyBlock[],
  other: readonly BodyBlock[],
): BlockAlignment {
  const matches = baseline.map(() => -1);
  const taken = new Set<number>();

  const byId = new Map<string, number>();
  other.forEach((block, index) => {
    if (block.id) byId.set(block.id, index);
  });
  const sharedId = baseline.some((block) => block.id !== null && byId.has(block.id));
  if (sharedId) {
    baseline.forEach((block, index) => {
      const found = block.id === null ? undefined : byId.get(block.id);
      if (found === undefined || taken.has(found)) return;
      matches[index] = found;
      taken.add(found);
    });
  }

  const byKey = new Map<string, number[]>();
  other.forEach((block, index) => {
    const list = byKey.get(block.key);
    if (list) list.push(index);
    else byKey.set(block.key, [index]);
  });
  baseline.forEach((block, index) => {
    if (matches[index] !== -1) return;
    const candidates = byKey.get(block.key);
    while (candidates && candidates.length > 0) {
      const found = candidates.shift() as number;
      if (taken.has(found)) continue;
      matches[index] = found;
      taken.add(found);
      return;
    }
  });

  const baseLeft = matches.flatMap((match, index) => (match === -1 ? [index] : []));
  const otherLeft = other.flatMap((_, index) => (taken.has(index) ? [] : [index]));
  if (
    baseLeft.length > 0 &&
    baseLeft.length === otherLeft.length &&
    baseLeft.every((index, position) => {
      const candidate = other[otherLeft[position] as number];
      return candidate !== undefined && candidate.nodeName === baseline[index]?.nodeName;
    })
  ) {
    baseLeft.forEach((index, position) => {
      const found = otherLeft[position] as number;
      matches[index] = found;
      taken.add(found);
    });
  }

  const order = matches.filter((match) => match !== -1);
  const reordered = order.some((match, position) => {
    const previous = position > 0 ? order[position - 1] : undefined;
    return previous !== undefined && match <= previous;
  });
  return {
    matches,
    added: other.flatMap((_, index) => (taken.has(index) ? [] : [index])),
    reordered,
  };
}

/** At most 40 characters of a block, marks dropped, ellipses when cut. */
function blockSnippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return "";
  return clean.length <= 40 ? clean : `\u2026${clean.slice(0, 40)}\u2026`;
}

/** `Launch plan · paragraph: …the deadline slipped…`, never a raw key. */
export function blockLabel(cardTitle: string, nodeName: string, text: string): string {
  const snippet = blockSnippet(text);
  return snippet
    ? `${cardTitle} \u00b7 ${nodeName}: ${snippet}`
    : `${cardTitle} \u00b7 ${nodeName}`;
}

export function bodyBlockKey(cardId: string, block: BodyBlock): string {
  return `card:${cardId}:body:${block.key}`;
}
