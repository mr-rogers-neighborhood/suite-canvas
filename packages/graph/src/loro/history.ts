import type { Change, LoroDoc, OpId } from "loro-crdt";
import {
  compareHistoryStates,
  HISTORY_POINT_LIMIT,
  type HistoryPoint,
  type HistoryRestorePreview,
  type HistoryState,
  historyFrontier,
  historyPoint,
  RESTORE_ORIGIN,
} from "../history.js";
import { firstLine, textOf } from "../records/containers.js";
import type { DocContext } from "./context.js";
import { STRUCT_KEYS } from "./keys.js";

/**
 * Owns the history surface: the saved points a workspace already has in its
 * Loro oplog, the point-in-time view of one of them, and the restore.
 *
 * Nothing here persists anything. A point is a change Loro recorded; the view
 * of a point is a fork checked out at that change, dropped as soon as the
 * preview is read; and a restore is `revertTo`, which writes ordinary
 * operations, so it syncs to peers and lands on the undo stack like any edit.
 */

const STATE_KEYS = {
  boards: STRUCT_KEYS.boards,
  cards: STRUCT_KEYS.cards,
  sections: STRUCT_KEYS.sections,
  edges: STRUCT_KEYS.edges,
  tags: STRUCT_KEYS.tags,
  placements: STRUCT_KEYS.placements,
} as const;

/** Card id to the line that names it, read from any document at any version. */
function titlesOf(doc: LoroDoc): Record<string, string> {
  const titles = doc.getMap(STRUCT_KEYS.titles);
  const contents = doc.getMap(STRUCT_KEYS.content);
  const out: Record<string, string> = {};
  for (const cardId of doc.getMap(STRUCT_KEYS.cards).keys()) {
    // An untitled card is named by its body's first line everywhere else, and
    // this preview answers "which card is this", so it does the same.
    out[cardId] = firstLine(textOf(titles.get(cardId))) || firstLine(textOf(contents.get(cardId)));
  }
  return out;
}

function stateOf(doc: LoroDoc): HistoryState {
  return {
    boards: doc.getMap(STATE_KEYS.boards).keys(),
    cards: doc.getMap(STATE_KEYS.cards).keys(),
    sections: doc.getMap(STATE_KEYS.sections).keys(),
    edges: doc.getMap(STATE_KEYS.edges).keys(),
    tags: doc.getMap(STATE_KEYS.tags).keys(),
    placements: doc.getMap(STATE_KEYS.placements).keys(),
    titles: titlesOf(doc),
  };
}

/** The document as it stood at `frontiers`, read from a fork that is thrown away. */
function stateAt(doc: LoroDoc, frontiers: OpId[]): HistoryState | null {
  const fork = doc.fork();
  try {
    fork.checkout(frontiers);
  } catch {
    // A point older than the document's shallow history cannot be reconstructed.
    return null;
  }
  return stateOf(fork);
}

function parsePointId(id: string): OpId | null {
  const at = id.lastIndexOf("@");
  if (at <= 0) return null;
  const counter = Number(id.slice(at + 1));
  const peer = id.slice(0, at);
  if (peer.length === 0 || !Number.isInteger(counter) || counter < 0) return null;
  return { peer: peer as OpId["peer"], counter };
}

export function historyMethods(ctx: DocContext) {
  const points = (limit: number): HistoryPoint[] => {
    const entries = [...ctx.doc.getAllChanges().entries()].flatMap(([peer, changes]) =>
      changes.map((change) => ({ peer, change })),
    );
    entries.sort(
      (a, b) =>
        b.change.lamport - a.change.lamport ||
        b.change.counter - a.change.counter ||
        b.peer.localeCompare(a.peer),
    );
    return entries.slice(0, Math.max(1, Math.trunc(limit))).map(({ peer, change }, index) =>
      historyPoint(
        {
          peer,
          counter: change.counter,
          length: change.length,
          lamport: change.lamport,
          timestamp: change.timestamp,
          origin: change.message ?? null,
        },
        index === 0,
      ),
    );
  };

  /** One point by id, or null when the oplog no longer holds that change. */
  const find = (pointId: string): HistoryPoint | null => {
    const id = parsePointId(pointId);
    if (!id) return null;
    // Loro throws for an id the oplog does not hold, and a stale panel row is
    // exactly that: a point a compaction or a peer's history removed.
    let change: Change;
    try {
      change = ctx.doc.getChangeAt(id);
    } catch {
      return null;
    }
    const point = historyPoint({
      peer: id.peer,
      counter: id.counter,
      length: change.length,
      lamport: change.lamport,
      timestamp: change.timestamp,
      origin: change.message ?? null,
    });
    // "Current" is the frontier the document itself sits at, which is one
    // comparison; the list's first row answers the same question by sort order.
    return { ...point, current: ctx.doc.cmpWithFrontiers(historyFrontier(point)) === 0 };
  };

  const previewOf = (point: HistoryPoint): HistoryRestorePreview | null => {
    const then = stateAt(ctx.doc, historyFrontier(point));
    if (!then) return null;
    return compareHistoryStates(stateOf(ctx.doc), then, point);
  };

  return {
    /** Saved points, newest first. The first one is the document as it stands. */
    listHistoryPoints(limit: number = HISTORY_POINT_LIMIT): HistoryPoint[] {
      return points(limit);
    },

    getHistoryPoint(pointId: string): HistoryPoint | null {
      return find(pointId);
    },

    /** The state a restore would produce, without writing anything. */
    previewRestore(pointId: string): HistoryRestorePreview | null {
      const point = find(pointId);
      return point ? previewOf(point) : null;
    },

    /**
     * Reverts every change made after `pointId` and commits the revert, so it is
     * one undoable step that peers receive like any other edit. Returns what the
     * restore did, or null when the point is no longer in the document's oplog.
     */
    restoreToPoint(pointId: string): HistoryRestorePreview | null {
      const point = find(pointId);
      if (!point) return null;
      const plan = previewOf(point);
      ctx.doc.revertTo(historyFrontier(point));
      // `revertTo` leaves its operations uncommitted; without this the revert
      // would ride the next unrelated commit and carry no label of its own.
      ctx.commit(RESTORE_ORIGIN);
      return plan;
    },
  };
}
