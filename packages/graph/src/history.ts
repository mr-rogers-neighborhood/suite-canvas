import type { OpId } from "loro-crdt";

/**
 * The vocabulary of the history panel: what a saved point is, how a change's
 * origin reads in a list, and what restoring one would add or remove.
 *
 * A point is a Loro change, not a record of our own. The document already keeps
 * every commit in its oplog, so the panel reads that history instead of writing
 * a second one (see `loro/history.ts` for the reads and the restore).
 */

/** How many points the panel keeps in hand. The oplog keeps all of them. */
export const HISTORY_POINT_LIMIT = 40;

/** A prefix of the origin a restore commits under. */
export const RESTORE_ORIGIN = "struct:history-restore";

/** Origins whose label is not a mechanical reading of the verb. */
export const HISTORY_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  "sys:init": "Workspace created",
  "struct:seed": "Workspace started",
  "struct:card": "Edited a card",
  "struct:type": "Changed a card type",
  "struct:field": "Changed a field",
  "struct:tag": "Changed a tag",
  "struct:edge": "Changed a link",
  "struct:write": "Changed the workspace",
  "struct:write-rich-text": "Wrote card text",
  undo: "Undo",
  redo: "Redo",
  [RESTORE_ORIGIN]: "Restored an earlier point",
};

/**
 * Verb prefixes and the sentence they open. The rest of the origin names what
 * was touched, so `create-card` reads "Added card" and `move-cards` "Moved
 * cards" without one entry per verb.
 */
export const HISTORY_VERB_RULES: ReadonlyArray<readonly [string, string]> = [
  ["create-", "Added"],
  ["add-", "Added"],
  ["duplicate-", "Duplicated"],
  ["delete-", "Deleted"],
  ["remove-", "Removed"],
  ["purge-", "Deleted"],
  ["rename-", "Renamed"],
  ["move-", "Moved"],
  ["resize-", "Resized"],
  ["reorder-", "Reordered"],
  ["set-", "Changed"],
  ["update-", "Changed"],
  ["apply-", "Applied"],
  ["place-", "Placed"],
  ["unplace-", "Removed"],
  ["clear-", "Cleared"],
];

/** Origins that mean a person typed in a card, whichever editor wrote them. */
const TEXT_ORIGINS = ["loroSyncPlugin", "text:"];

/**
 * What a change's recorded origin reads as. Origins are written by the document
 * layer, so this is a table over names rather than a parse of English: a new
 * write is a new row, and an unknown one still reads as a sentence.
 */
export function historyLabel(origin: string | null | undefined): string {
  const name = origin?.trim();
  if (!name) return "Changed the workspace";
  const exact = HISTORY_ORIGIN_LABELS[name];
  if (exact) return exact;
  if (TEXT_ORIGINS.some((prefix) => name.startsWith(prefix))) return "Typed in a card";
  const [prefix, verb = ""] = name.split(":", 2) as [string, string];
  if (prefix === "template") return "Started from a template";
  if (prefix === "obsidian") return "Imported an Obsidian vault";
  const noun = verb.replace(/-/gu, " ").trim();
  for (const [candidate, opener] of HISTORY_VERB_RULES) {
    if (verb.startsWith(candidate)) {
      const rest = verb.slice(candidate.length).replace(/-/gu, " ");
      return rest ? `${opener} ${rest}` : opener;
    }
  }
  return noun ? `Changed ${noun}` : "Changed the workspace";
}

/** One saved point: a Loro change and the frontier it ends at. */
export interface HistoryPoint {
  /** `${peer}@${counter}`, the change's first operation. Stable across reads. */
  id: string;
  peer: string;
  counter: number;
  /** Operations in the change; a burst of same-origin writes merges into one. */
  length: number;
  lamport: number;
  /** When the change was written, in Unix milliseconds, or null when unstamped. */
  at: number | null;
  /** The commit origin the change recorded, or null when it carried none. */
  origin: string | null;
  /** What to show in the list. */
  label: string;
  /** True for the newest point, which is the document as it stands. */
  current: boolean;
}

export interface HistoryChangeInput {
  peer: string;
  counter: number;
  length: number;
  lamport: number;
  /** Loro stores seconds; a change written before it stamped committs is 0. */
  timestamp: number;
  origin: string | null;
}

export function historyPoint(input: HistoryChangeInput, current = false): HistoryPoint {
  return {
    id: `${input.peer}@${input.counter}`,
    peer: input.peer,
    counter: input.counter,
    length: input.length,
    lamport: input.lamport,
    at: input.timestamp > 0 ? input.timestamp * 1000 : null,
    origin: input.origin,
    label: historyLabel(input.origin),
    current,
  };
}

/** The frontier that ends a change: the id of its last operation. */
export function historyFrontier(point: HistoryPoint): OpId[] {
  // Loro types a peer id as a decimal string; a point carries it as whatever the
  // oplog reported, so the narrowing is about the type, not about trust.
  return [{ peer: point.peer as OpId["peer"], counter: point.counter + point.length - 1 }];
}

/** What one side of a comparison holds, by id. Titles are card id to title. */
export interface HistoryState {
  boards: readonly string[];
  cards: readonly string[];
  sections: readonly string[];
  edges: readonly string[];
  tags: readonly string[];
  placements: readonly string[];
  titles: Readonly<Record<string, string>>;
}

export type HistoryRecordKind = "boards" | "cards" | "sections" | "edges" | "tags" | "placements";

export const HISTORY_RECORD_KINDS: readonly HistoryRecordKind[] = [
  "boards",
  "cards",
  "sections",
  "edges",
  "tags",
  "placements",
];

export type HistoryCounts = Record<HistoryRecordKind, number>;

function emptyCounts(): HistoryCounts {
  return { boards: 0, cards: 0, sections: 0, edges: 0, tags: 0, placements: 0 };
}

/** What restoring one point would do, in counts and in one sentence. */
export interface HistoryRestorePreview {
  point: HistoryPoint;
  /** Present at the point and absent now. */
  restored: HistoryCounts;
  /** Present now and absent at the point. */
  removed: HistoryCounts;
  /** Present on both sides; `changed` of them read differently. */
  kept: HistoryCounts;
  /** Cards kept on both sides whose title changed. */
  changed: number;
  /** Up to three titles that come back, for the sentence. */
  restoredTitles: readonly string[];
  /** Up to three titles that disappear, for the sentence. */
  removedTitles: readonly string[];
  /** True when restoring would write nothing. */
  empty: boolean;
  /** One sentence stating exactly what the restore does. */
  summary: string;
}

function compareKind(a: readonly string[], b: readonly string[]): { both: number; onlyA: number } {
  const left = new Set(a);
  const right = new Set(b);
  let both = 0;
  for (const id of left) if (right.has(id)) both += 1;
  return { both, onlyA: left.size - both };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The sentence a confirm button sits under, so nothing is a surprise. */
export function historyRestoreSummary(preview: {
  restored: HistoryCounts;
  removed: HistoryCounts;
  changed: number;
}): string {
  const touched = HISTORY_RECORD_KINDS.reduce(
    (total, kind) => total + preview.restored[kind] + preview.removed[kind],
    0,
  );
  if (touched === 0 && preview.changed === 0) {
    return "Nothing would change: this point is the current document.";
  }
  const parts: string[] = [];
  if (preview.restored.cards > 0)
    parts.push(`brings back ${plural(preview.restored.cards, "card")}`);
  if (preview.removed.cards > 0) parts.push(`removes ${plural(preview.removed.cards, "card")}`);
  if (preview.changed > 0) parts.push(`rewrites the text of ${plural(preview.changed, "card")}`);
  if (preview.restored.boards > 0) {
    parts.push(`restores ${plural(preview.restored.boards, "board")}`);
  }
  if (preview.removed.boards > 0) parts.push(`deletes ${plural(preview.removed.boards, "board")}`);
  if (parts.length === 0) parts.push("rewrites the workspace");
  return `Restoring reverts every change after this point, for everyone: it ${parts.join(", ")}. Undo puts it back.`;
}

/**
 * What restoring `then` would change relative to `now`. Ids are enough for the
 * counts; titles are what makes the sentence specific.
 */
export function compareHistoryStates(
  now: HistoryState,
  then: HistoryState,
  point: HistoryPoint,
): HistoryRestorePreview {
  const restored = emptyCounts();
  const removed = emptyCounts();
  const kept = emptyCounts();
  for (const kind of HISTORY_RECORD_KINDS) {
    const { both, onlyA } = compareKind(then[kind], now[kind]);
    kept[kind] = both;
    restored[kind] = onlyA;
    removed[kind] = now[kind].length - both;
  }

  const nowCards = new Set(now.cards);
  const thenCards = new Set(then.cards);
  let changed = 0;
  const restoredTitles: string[] = [];
  const removedTitles: string[] = [];
  for (const id of nowCards) {
    if (!thenCards.has(id)) {
      const title = now.titles[id];
      if (title && removedTitles.length < 3) removedTitles.push(title);
      continue;
    }
    if ((now.titles[id] ?? "") !== (then.titles[id] ?? "")) changed += 1;
  }
  for (const id of thenCards) {
    if (nowCards.has(id)) continue;
    const title = then.titles[id];
    if (title && restoredTitles.length < 3) restoredTitles.push(title);
  }

  const preview = { restored, removed, changed };
  const total = HISTORY_RECORD_KINDS.reduce((sum, kind) => sum + restored[kind] + removed[kind], 0);
  return {
    point,
    restored,
    removed,
    kept,
    changed,
    restoredTitles,
    removedTitles,
    empty: total === 0 && changed === 0,
    summary: historyRestoreSummary(preview),
  };
}
