/**
 * What one *room* may cost the process.
 *
 * `http/rateLimit.ts` bounds a client address: it answers "may this caller do
 * more of this soon". It cannot answer "is this room too big to serve", which
 * is the question the relay actually runs into — one 5 000-card board, or one
 * board with fifty readers, degrades the process for everybody. These limits are
 * per room, and each refusal carries a stable `code` so an operator can grep a
 * log line, a metric or this page without reading the call site.
 *
 * Every refusal here happens **where nothing has been written yet**: a join is
 * refused before a session exists, and backpressure refuses *work*, never a
 * save. A document that is already open keeps saving past every limit in this
 * file, which is what keeps a cap a refusal rather than a data-loss bug.
 *
 * The numbers are read from the environment so a deployment can tune them, and
 * `scripts/generate-limits.mjs` publishes them into `docs/reference/limits.md`
 * from these constants — a cap that is not enforced cannot be published.
 */

/** Refusal codes. Stable strings: they appear in logs, metrics and the docs. */
export const LIMIT_CODES = {
  /** A join refused because the room is at its peer cap. */
  peers: "peer-limit",
  /** A join refused because the room's stored document is over its byte ceiling. */
  document: "document-limit",
  /** A projection refused because the board holds more cards than the cap. */
  cards: "card-limit",
  /** Work refused because that room already has its outstanding bound in flight. */
  backpressure: "room-backpressure",
  /** A projection rebuild abandoned because it exceeded its build-time cap. */
  projectionBuild: "projection-build-limit",
} as const;

export type LimitCode = (typeof LIMIT_CODES)[keyof typeof LIMIT_CODES];

/**
 * Peers one room serves at once.
 *
 * Every session in a room holds its own copy of the document on the wire and in
 * memory, so peers multiply the cost of one board. 64 is above what a shared
 * board sees in practice and far below the point where the copy cost dominates
 * the document itself; `SUITE_MAX_PEERS_PER_ROOM` tunes it.
 */
export const DEFAULT_MAX_PEERS_PER_ROOM = 64;

/**
 * Rooms whose work is bounded, and by how much.
 *
 * A room may have this many tasks queued (a rebuild, an open, a publish) before
 * the next request is refused instead of queued. Rebuilds are idempotent from
 * the source, so refusing one costs freshness, never data — which is exactly
 * the trade a busy board should make on behalf of the others.
 */
export const DEFAULT_ROOM_OUTSTANDING = 8;

/** A refusal: what was hit, in a form a log line and a test can both assert. */
export interface LimitRefusal {
  code: LimitCode;
  /** Names the limit, the current value and the variable that sets it. */
  message: string;
}

/** Adds the `:presence` / `:cursors` suffix rule, so a limit sees the room it is about. */
export function limitRoomOf(roomId: string): string {
  for (const suffix of [":presence", ":cursors"] as const) {
    if (roomId.length > suffix.length && roomId.endsWith(suffix)) {
      return roomId.slice(0, -suffix.length);
    }
  }
  return roomId;
}

/** Reads a positive integer from the environment, falling back on anything else. */
function positiveInteger(raw: string | undefined, fallback: number): number {
  const text = raw?.trim();
  if (!text) return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** Peer cap per room: `SUITE_MAX_PEERS_PER_ROOM`, default 64. */
export function peersPerRoomLimit(
  env: { SUITE_MAX_PEERS_PER_ROOM?: string | undefined } = process.env,
): number {
  return positiveInteger(env.SUITE_MAX_PEERS_PER_ROOM, DEFAULT_MAX_PEERS_PER_ROOM);
}

/** Outstanding-work bound per room: `SUITE_ROOM_OUTSTANDING_MAX`, default 8. */
export function roomOutstandingLimit(
  env: { SUITE_ROOM_OUTSTANDING_MAX?: string | undefined } = process.env,
): number {
  return positiveInteger(env.SUITE_ROOM_OUTSTANDING_MAX, DEFAULT_ROOM_OUTSTANDING);
}

export interface RoomJoinFacts {
  /** Peers in the room other than the relay's own worker, or `null` if unreadable. */
  peers: number | null;
  /** Stored size of the room's document in bytes, or `null` when it was never saved. */
  documentBytes: number | null;
  /** Budget the document is compared against; `Infinity` is unlimited. */
  documentBudget: number;
  /** Effective peer cap. */
  peerLimit: number;
}

/**
 * Why a join is refused, or null when it may proceed.
 *
 * Order matters: peers first, because it is the cheapest to answer and the one
 * a busy room hits first; then the document ceiling, which is the check that
 * keeps the process from mapping a document it cannot serve. An unreadable
 * count is never a refusal — "cannot tell" is not proof of a breach, and a
 * false refusal locks a reader out of a healthy room.
 */
export function joinRefusal(roomId: string, facts: RoomJoinFacts): LimitRefusal | null {
  if (facts.peers !== null && facts.peers >= facts.peerLimit) {
    return {
      code: LIMIT_CODES.peers,
      message:
        `This room already has ${String(facts.peers)} peers connected, which is its cap ` +
        `(SUITE_MAX_PEERS_PER_ROOM=${String(facts.peerLimit)}). Try again when somebody leaves.`,
    };
  }
  if (
    facts.documentBytes !== null &&
    Number.isFinite(facts.documentBudget) &&
    facts.documentBytes > facts.documentBudget
  ) {
    return {
      code: LIMIT_CODES.document,
      message:
        `The document behind room ${roomId} is ${String(facts.documentBytes)} bytes, over its ` +
        `${String(facts.documentBudget)}-byte ceiling (SUITE_DOCUMENT_BYTES_PER_WORKSPACE). ` +
        "Its bytes are kept: export the workspace, trim it, then reopen it.",
    };
  }
  return null;
}

/**
 * A per-room bound on outstanding work.
 *
 * The counter is per room: the caller enters before queueing a task and leaves
 * when it settles, and `atLimit` is what a *rebuild* consults before adding one
 * more. Rebuilds are refused rather than queued because they are idempotent from
 * the source — a skipped rebuild costs freshness for one board, where a queue
 * behind a stalled board costs memory for the whole process.
 */
export class RoomWorkBudget {
  readonly limit: number;
  private readonly outstanding = new Map<string, number>();

  constructor(limit: number = DEFAULT_ROOM_OUTSTANDING) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  /** Counts one more task for `roomId`. */
  enter(roomId: string): void {
    this.outstanding.set(roomId, (this.outstanding.get(roomId) ?? 0) + 1);
  }

  /** Gives a slot back; a no-op for a room with none, so a double leave is safe. */
  leave(roomId: string): void {
    const current = this.outstanding.get(roomId) ?? 0;
    if (current <= 1) {
      this.outstanding.delete(roomId);
      return;
    }
    this.outstanding.set(roomId, current - 1);
  }

  /** Slots in flight for one room. */
  inFlight(roomId: string): number {
    return this.outstanding.get(roomId) ?? 0;
  }

  /** Whether `roomId` already holds its bound, so new work should be refused. */
  atLimit(roomId: string): boolean {
    return this.inFlight(roomId) >= this.limit;
  }

  /** Rooms currently holding at least one slot. */
  rooms(): number {
    return this.outstanding.size;
  }
}
