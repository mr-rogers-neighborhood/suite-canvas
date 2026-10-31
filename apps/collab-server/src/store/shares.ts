import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { configureConnection } from "./persistence.js";

export const shareScopes = ["workspace", "board", "card", "selection"] as const;
export type ShareScope = (typeof shareScopes)[number];

export const shareRoles = ["viewer", "editor"] as const;
export type ShareRole = (typeof shareRoles)[number];

/** Room prefix for shares that do not open a whole workspace room. */
export const SHARE_ROOM_PREFIX = "share-";

/** Schema version stamped into `PRAGMA user_version`; bump only with a migration. */
export const SHARE_STORE_SCHEMA = 1;

/** Upper bound on the cards of one selection share, so a link stays a subset. */
export const MAX_SELECTION_CARDS = 200;

/**
 * Longest slug a published link carries. A slug is the page name in the reader
 * address (`/s/<slug>?share=<token>`), so it stays short enough to read out
 * loud and is cut at a word boundary rather than mid-word.
 */
export const MAX_SHARE_SLUG_LENGTH = 48;

/**
 * Name bytes read when deriving a slug. A card title can be longer than any slug
 * needs to be; the rest is only cut work, never a refusal.
 */
export const MAX_SHARE_NAME_LENGTH = 200;

/** Suffixes tried before a slug falls back to a random tail. */
const SLUG_COLLISION_LIMIT = 50;

/**
 * Lifetime of an exchanged share session. A link token is a permanent
 * capability; a session is the short-lived stand-in a browser presents after
 * the exchange, so a leaked log line or history entry stops mattering. Every
 * successful lookup slides the expiry by this window, which keeps an active tab
 * working without lengthening the life of an idle one. A session never outlives
 * its share: revocation deletes the row and the share's own expiry caps it.
 */
export const SHARE_SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * How stale a share's last-used timestamp may get. A resolve is a real use, but
 * a viewer reloads and re-resolves often, so the column is written at most once
 * per share per minute; a busy link therefore costs at most one small UPDATE a
 * minute instead of one per request. The value is metadata, never a credential:
 * it tells the owner whether a link was ever opened, nothing about who did.
 */
export const SHARE_LAST_USED_GRANULARITY_MS = 60 * 1000;

export interface Share {
  id: string;
  scope: ShareScope;
  role: ShareRole;
  workspaceId: string;
  boardId: string | null;
  /**
   * The board the author was looking at when the link was made, for the visitor's
   * first open. Not a scope: a workspace share keeps publishing the whole
   * workspace, and this only says where to start reading it.
   */
  startBoardId: string | null;
  cardId: string | null;
  createdAt: number;
  revokedAt: number | null;
  /** Epoch milliseconds; null means the link does not expire. */
  expiresAt: number | null;
  /**
   * Epoch milliseconds of the last time the link was resolved, or null when it
   * was never used. Coarse to the minute: see `SHARE_LAST_USED_GRANULARITY_MS`.
   * A listing never touches it, so this only moves when someone actually opened
   * the link.
   */
  lastUsedAt: number | null;
  /**
   * Sync room this share opens. Workspace shares open the workspace room. Board,
   * card and selection shares open `share-<token>`; because only the token hash
   * is stored, the room id is persisted on create so the projection worker can
   * rebuild a share without ever seeing the token. Rows written before the room
   * id column existed have `roomId: null` until they are resolved with their token.
   */
  roomId: string | null;
  /**
   * Cards of a selection share, in the owner's order. Empty for every other
   * scope; a board or card share names its target in `boardId`/`cardId`.
   */
  cardIds: string[];
  /** How many cards the link projects: the selection size, 1 for a card share. */
  cardCount: number;
  /**
   * Page name of the published link, derived once when the link is created and
   * then frozen: the reader address is `/s/<slug>?share=<token>`, so changing it
   * would move a page people already hold. Unique per workspace and never
   * reused, including after revocation, which is what lets an author reason
   * about what a slug names. It is not a credential: the token still resolves.
   */
  slug: string;
}

export interface CreateShareInput {
  workspaceId: string;
  scope: ShareScope;
  role: ShareRole;
  boardId?: string | null;
  /**
   * The board to open on the visitor's first visit. Accepted by every scope,
   * because it narrows nothing: a workspace share still publishes the workspace.
   */
  startBoardId?: string | null;
  cardId?: string | null;
  /** Cards of a selection share; ignored by every other scope. */
  cardIds?: readonly string[];
  /**
   * Human name of what the link publishes (a card or board title). It is read
   * once, at creation, to derive `Share.slug`; it is not stored and never
   * re-read, so renaming the card leaves the page address alone. Without it the
   * slug starts from the scope word.
   */
  name?: string | null;
  /**
   * Epoch milliseconds, or null (or 0) for a link that never expires. Leaving it
   * out asks the server for its default: no expiry on a self-host, 30 days on
   * the hosted relay.
   */
  expiresAt?: number | null;
}

export interface CreatedShare {
  /** Raw capability token. Never persisted; the store only keeps its SHA-256 hash. */
  token: string;
  share: Share;
}

export interface ShareSession {
  /** Raw session credential. Never persisted; the store only keeps its SHA-256 hash. */
  session: string;
  /** Epoch milliseconds at which the session stops authenticating. */
  expiresAt: number;
}

export interface ShareStore {
  create: (input: CreateShareInput) => CreatedShare;
  /**
   * Active share for a raw token, or null when unknown or revoked. A success is
   * a real use, so it records `lastUsedAt` — at most once per share per
   * `SHARE_LAST_USED_GRANULARITY_MS`.
   */
  resolve: (token: string) => Share | null;
  /**
   * Mints a session credential for a share that was just resolved. The caller
   * gets the only copy of the value; the store keeps `sha256(session)`.
   */
  createSession: (share: Share, ttlMs?: number) => ShareSession;
  /**
   * Active share behind a session credential, or null when the session is
   * unknown, expired, or its share was revoked or expired. A successful lookup
   * slides the session expiry by `SHARE_SESSION_TTL_MS` and records
   * `lastUsedAt`, subject to the same once-a-minute granularity as `resolve`.
   */
  resolveSession: (session: string) => Share | null;
  /** Drops one session credential, for the sign-out route. */
  deleteSession: (session: string) => void;
  /**
   * True when the raw token belongs to a stored share, revoked or not. Revoking
   * a workspace link has no plaintext token to compare against, so the live-kick
   * path pairs this with `resolve` to close sessions whose share credential no
   * longer authenticates.
   */
  isShareToken: (token: string) => boolean;
  /** Share by id, including revoked ones. */
  get: (id: string) => Share | null;
  /** Active shares of a workspace, newest first. */
  list: (workspaceId: string) => Share[];
  /** Active shares of every workspace, newest first, for the projection worker. */
  listAllActive: () => Share[];
  /** True when a workspace has an active board or card editor share. */
  hasEditorShare: (workspaceId: string) => boolean;
  /** Number of active shares in a workspace, for the creation cap. */
  countActive: (workspaceId: string) => number;
  /** Non-revoked shares whose expiry has passed, for the server sweep. */
  listExpired: () => Share[];
  /** Revokes a share; returns the updated record, or null when it does not exist. */
  revoke: (id: string) => Share | null;
  /** Revokes every active share of a workspace and returns the revoked records. */
  revokeAll: (workspaceId: string) => Share[];
  /** Last projection snapshot a share room was rebuilt from, or null when none was stored. */
  getBaseline: (shareId: string) => Uint8Array | null;
  /** Replaces the baseline snapshot of a share; the draft lifecycle reads it on reopen. */
  setBaseline: (shareId: string, snapshot: Uint8Array) => void;
  deleteBaseline: (shareId: string) => void;
  close: () => void;
}

const TOKEN_BYTES = 24;
const SESSION_BYTES = 32;
const MAX_ID_LENGTH = 512;
const MAX_SESSION_LENGTH = 512;

interface ShareRow {
  id: string;
  scope: string;
  role: string;
  workspace_id: string;
  board_id: string | null;
  card_id: string | null;
  /** Where the link should open. Null on rows created before the column existed. */
  start_board_id: string | null;
  created_at: number;
  revoked_at: number | null;
  expires_at: number | null;
  /** Null on rows created before the column existed; `create` always fills it. */
  room_id: string | null;
  /** JSON array of card ids; null or unparseable reads as an empty selection. */
  card_ids: string | null;
  /** Epoch milliseconds of the last resolve; null on rows never used. */
  last_used_at: number | null;
  /** Null on rows created before the column existed; the migration backfills it. */
  slug: string | null;
}

interface ShareSessionRow {
  session_hash: string;
  share_id: string;
  created_at: number;
  expires_at: number;
}

export function shareRoomId(scope: ShareScope, workspaceId: string, token: string): string {
  return scope === "workspace" ? workspaceId : `${SHARE_ROOM_PREFIX}${token}`;
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Sessions are stored like tokens: as a hash, so a stolen database cannot be replayed. */
export function hashShareSession(session: string): string {
  return createHash("sha256").update(session, "utf8").digest("hex");
}

/**
 * A name as a URL page name: lowercase ASCII words joined by `-`.
 * `"Q4 · Planning (draft)"` → `"q4-planning-draft"`. Returns `""` when nothing
 * survives, so the caller can fall back to the scope word.
 */
export function slugifyShareName(name: string | null | undefined): string {
  if (typeof name !== "string") return "";
  const flattened = name
    .slice(0, MAX_SHARE_NAME_LENGTH)
    // Decompose first so `é` becomes `e` instead of a separator.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (flattened.length <= MAX_SHARE_SLUG_LENGTH) return flattened;

  const cut = flattened.slice(0, MAX_SHARE_SLUG_LENGTH);
  const boundary = cut.lastIndexOf("-");
  // Cut at the last whole word only when that keeps most of the name.
  const kept = boundary > MAX_SHARE_SLUG_LENGTH / 2 ? cut.slice(0, boundary) : cut;
  return kept.replace(/-+$/u, "");
}

/**
 * The slug a link starts from: the target's name, or the scope word when the
 * name is missing or has no URL-safe characters left.
 */
export function shareSlugBase(name: string | null | undefined, scope: ShareScope): string {
  const fromName = slugifyShareName(name);
  return fromName.length > 0 ? fromName : scope;
}

/** `<base>-<suffix>`, trimmed so the suffix always fits the length cap. */
export function shareSlugWithSuffix(base: string, suffix: string): string {
  const room = MAX_SHARE_SLUG_LENGTH - suffix.length - 1;
  const stem = base.slice(0, Math.max(1, room)).replace(/-+$/u, "");
  return `${stem.length > 0 ? stem : base.slice(0, 1)}-${suffix}`;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function normalizeId(value: unknown): string | null {
  return isId(value) ? value.trim() : null;
}

/**
 * Parses a card list for a selection share. The order the owner picked is kept
 * and repeated ids are dropped, so the count always matches the distinct cards.
 */
function normalizeCardIds(value: unknown): { cardIds: string[]; problem: string | null } {
  if (value == null) return { cardIds: [], problem: null };
  if (!Array.isArray(value)) return { cardIds: [], problem: "Card ids must be an array." };

  const cardIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isId(entry)) return { cardIds: [], problem: "Every card id must be a non-empty string." };
    const id = entry.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    cardIds.push(id);
  }
  if (cardIds.length > MAX_SELECTION_CARDS) {
    return {
      cardIds,
      problem: `A selection link can include at most ${MAX_SELECTION_CARDS} cards.`,
    };
  }
  return { cardIds, problem: null };
}

/** Validates a create payload; returns a human-readable problem, or null when valid. */
export function validateShareInput(input: {
  workspaceId?: unknown;
  scope?: unknown;
  role?: unknown;
  boardId?: unknown;
  startBoardId?: unknown;
  cardId?: unknown;
  cardIds?: unknown;
  name?: unknown;
  expiresAt?: unknown;
}): string | null {
  if (!isId(input.workspaceId)) return "A workspace id is required.";
  if (!shareScopes.includes(input.scope as ShareScope)) {
    return "Scope must be workspace, board, card or selection.";
  }
  if (!shareRoles.includes(input.role as ShareRole)) {
    return "Role must be viewer or editor.";
  }
  // A name is only ever spent on the slug, so a long one is trimmed rather than
  // refused: a title nobody can publish would be a worse answer than a short
  // page name.
  if (input.name != null && typeof input.name !== "string") return "The name must be a string.";

  const scope = input.scope as ShareScope;
  const boardId = normalizeId(input.boardId);
  const startBoardId = normalizeId(input.startBoardId);
  const cardId = normalizeId(input.cardId);
  const cards = normalizeCardIds(input.cardIds);
  if (input.boardId != null && !boardId) return "The board id must be a non-empty string.";
  if (input.startBoardId != null && !startBoardId) {
    return "The start board id must be a non-empty string.";
  }
  if (input.cardId != null && !cardId) return "The card id must be a non-empty string.";
  if (input.expiresAt != null && input.expiresAt !== 0) {
    if (
      typeof input.expiresAt !== "number" ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= Date.now()
    ) {
      return "The expiry must be a future timestamp.";
    }
  }

  if (scope !== "selection") {
    if (cards.problem) return cards.problem;
    if (cards.cardIds.length > 0) return "Only selection shares take card ids.";
  }

  switch (scope) {
    case "workspace":
      if (boardId || cardId) return "Workspace shares do not take a board or card.";
      return null;
    case "board":
      if (!boardId) return "Board shares need a board id.";
      if (cardId) return "Board shares do not take a card id.";
      return null;
    case "card":
      if (!cardId) return "Card shares need a card id.";
      return null;
    case "selection":
      if (input.role === "editor") return "Selection links are read-only for now.";
      if (!boardId) return "Selection shares need a board id.";
      if (cardId) return "Selection shares do not take a single card id.";
      if (cards.problem) return cards.problem;
      if (cards.cardIds.length === 0) return "Selection shares need at least one card id.";
      return null;
  }
}

/** Reads the persisted card id JSON; a corrupt row reads as an empty selection. */
function parseStoredCardIds(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => isId(entry)).map((entry) => entry.trim());
  } catch {
    return [];
  }
}

function toShare(row: ShareRow, token: string | null): Share {
  const scope = row.scope as ShareScope;
  const storedRoom = row.room_id ?? null;
  const cardIds = scope === "selection" ? parseStoredCardIds(row.card_ids) : [];
  let roomId = storedRoom;
  if (scope === "workspace") roomId = storedRoom ?? row.workspace_id;
  else if (!roomId && token) roomId = shareRoomId(scope, row.workspace_id, token);
  const cardId = row.card_id ?? null;
  return {
    id: row.id,
    scope,
    role: row.role as ShareRole,
    workspaceId: row.workspace_id,
    boardId: row.board_id ?? null,
    startBoardId: row.start_board_id ?? null,
    cardId,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
    expiresAt: row.expires_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    roomId,
    cardIds,
    cardCount: cardIds.length > 0 ? cardIds.length : cardId ? 1 : 0,
    slug: row.slug ?? "",
  };
}

/**
 * Gives every row written before slugs existed one. The backfill is the
 * explicit migration that documents the derivation: a workspace share takes
 * `workspace`, a board share `board`, and so on, and a second row in the same
 * workspace falls to `board-2`. The rule matches creation, so the store never
 * holds two spellings of the same rule.
 */
function backfillShareSlugs(db: DatabaseSync): void {
  const rows = db
    .prepare(
      "SELECT id, workspace_id, scope FROM shares WHERE slug IS NULL ORDER BY created_at, rowid",
    )
    .all() as { id: string; workspace_id: string; scope: string }[];
  if (rows.length === 0) return;

  const taken = db.prepare("SELECT 1 FROM shares WHERE workspace_id = ? AND slug = ?");
  const assign = db.prepare("UPDATE shares SET slug = ? WHERE id = ?");
  for (const row of rows) {
    const base = shareSlugBase(null, row.scope as ShareScope);
    let slug = base;
    for (let suffix = 2; taken.get(row.workspace_id, slug) !== undefined; suffix += 1) {
      // A slug is never reused, so even a revoked row keeps its own.
      slug = shareSlugWithSuffix(base, String(suffix));
      if (suffix > SLUG_COLLISION_LIMIT) {
        slug = shareSlugWithSuffix(base, randomBytes(4).toString("hex"));
        break;
      }
    }
    assign.run(slug, row.id);
  }
}

/**
 * Adds the columns of stores created before they existed. Older board and card
 * rows keep a null room id, which only affects projections that were never
 * rebuilt; `resolve` still derives the room from the token. Rows without card
 * ids read as an empty selection, which only predates the selection scope. Rows
 * without a slug get one from the migration, because a published page without
 * an address is a page nobody can return to.
 */
function migrateShareColumns(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(shares)").all() as { name?: string }[];
  if (!columns.some((column) => column.name === "room_id")) {
    db.exec("ALTER TABLE shares ADD COLUMN room_id TEXT");
    db.exec(
      "UPDATE shares SET room_id = workspace_id WHERE scope = 'workspace' AND room_id IS NULL",
    );
  }
  if (!columns.some((column) => column.name === "expires_at")) {
    db.exec("ALTER TABLE shares ADD COLUMN expires_at INTEGER");
  }
  // A hint for where a visitor starts reading, not a scope. Rows written before
  // this column simply have no opinion, and the visitor gets today's behaviour.
  if (!columns.some((column) => column.name === "start_board_id")) {
    db.exec("ALTER TABLE shares ADD COLUMN start_board_id TEXT");
  }
  if (!columns.some((column) => column.name === "card_ids")) {
    db.exec("ALTER TABLE shares ADD COLUMN card_ids TEXT");
  }
  if (!columns.some((column) => column.name === "last_used_at")) {
    db.exec("ALTER TABLE shares ADD COLUMN last_used_at INTEGER");
  }
  if (!columns.some((column) => column.name === "slug")) {
    db.exec("ALTER TABLE shares ADD COLUMN slug TEXT");
    backfillShareSlugs(db);
  }
  // One page name per workspace, revoked rows included: reusing a slug would
  // silently repoint an address someone already holds.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS shares_by_workspace_slug ON shares (workspace_id, slug)",
  );
}

export function createShareStore(path: string): ShareStore {
  const db = new DatabaseSync(path);
  // WAL, the busy timeout and the schema stamp, so the store no longer depends on
  // a boot-time pass in `server.ts` having configured the file first.
  configureConnection(db, SHARE_STORE_SCHEMA);
  db.exec(
    `CREATE TABLE IF NOT EXISTS shares (
       id TEXT PRIMARY KEY,
       token_hash TEXT NOT NULL UNIQUE,
       scope TEXT NOT NULL,
       role TEXT NOT NULL,
       workspace_id TEXT NOT NULL,
       board_id TEXT,
       start_board_id TEXT,
       card_id TEXT,
       created_at INTEGER NOT NULL,
       revoked_at INTEGER,
       expires_at INTEGER,
       room_id TEXT,
       card_ids TEXT,
       last_used_at INTEGER,
       slug TEXT
     );
     CREATE INDEX IF NOT EXISTS shares_by_workspace ON shares (workspace_id, created_at);
     CREATE TABLE IF NOT EXISTS share_baselines (
       share_id TEXT PRIMARY KEY,
       snapshot BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE TABLE IF NOT EXISTS share_sessions (
       session_hash TEXT PRIMARY KEY,
       share_id TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       expires_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS share_sessions_by_share ON share_sessions (share_id);`,
  );
  migrateShareColumns(db);

  const insert = db.prepare(
    `INSERT INTO shares (id, token_hash, scope, role, workspace_id, board_id, start_board_id, card_id, created_at, revoked_at, expires_at, room_id, card_ids, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  );
  const selectByHash = db.prepare("SELECT * FROM shares WHERE token_hash = ?");
  const countByHash = db.prepare("SELECT 1 AS found FROM shares WHERE token_hash = ?");
  const selectById = db.prepare("SELECT * FROM shares WHERE id = ?");
  const selectActive = db.prepare(
    "SELECT * FROM shares WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, rowid DESC",
  );
  const selectAllActive = db.prepare(
    `SELECT * FROM shares WHERE revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC, rowid DESC`,
  );
  const selectEditor = db.prepare(
    `SELECT 1 FROM shares
     WHERE workspace_id = ? AND role = 'editor' AND scope != 'workspace'
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`,
  );
  const countActiveByWorkspace = db.prepare(
    `SELECT COUNT(*) AS count FROM shares
     WHERE workspace_id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
  );
  const selectExpired = db.prepare(
    `SELECT * FROM shares
     WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY expires_at ASC`,
  );
  const revokeById = db.prepare(
    "UPDATE shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  );
  const touchLastUsed = db.prepare("UPDATE shares SET last_used_at = ? WHERE id = ?");
  const selectBaseline = db.prepare("SELECT snapshot FROM share_baselines WHERE share_id = ?");
  const upsertBaseline = db.prepare(
    `INSERT INTO share_baselines (share_id, snapshot, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(share_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
  );
  const deleteBaselineById = db.prepare("DELETE FROM share_baselines WHERE share_id = ?");
  const insertSession = db.prepare(
    "INSERT INTO share_sessions (session_hash, share_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  );
  const selectSession = db.prepare("SELECT * FROM share_sessions WHERE session_hash = ?");
  const touchSession = db.prepare(
    "UPDATE share_sessions SET expires_at = ? WHERE session_hash = ?",
  );
  const deleteSessionByHash = db.prepare("DELETE FROM share_sessions WHERE session_hash = ?");
  const deleteSessionsByShare = db.prepare("DELETE FROM share_sessions WHERE share_id = ?");
  const deleteExpiredSessions = db.prepare("DELETE FROM share_sessions WHERE expires_at <= ?");
  const backfillRoomId = db.prepare(
    "UPDATE shares SET room_id = ? WHERE id = ? AND room_id IS NULL",
  );
  const selectSlug = db.prepare("SELECT 1 FROM shares WHERE workspace_id = ? AND slug = ?");

  /**
   * The first free slug for a workspace: the base, then `-2`, `-3`, … and
   * finally a random tail. Taken means taken forever — a revoked row keeps its
   * slug — so a published address never changes owner.
   */
  const uniqueSlug = (workspaceId: string, base: string): string => {
    if (selectSlug.get(workspaceId, base) === undefined) return base;
    for (let suffix = 2; suffix <= SLUG_COLLISION_LIMIT; suffix += 1) {
      const candidate = shareSlugWithSuffix(base, String(suffix));
      if (selectSlug.get(workspaceId, candidate) === undefined) return candidate;
    }
    for (;;) {
      const candidate = shareSlugWithSuffix(base, randomBytes(4).toString("hex"));
      if (selectSlug.get(workspaceId, candidate) === undefined) return candidate;
    }
  };

  const get = (id: string): Share | null => {
    const row = selectById.get(id) as ShareRow | undefined;
    return row ? toShare(row, null) : null;
  };

  /**
   * Records a real use, at most once per share per `SHARE_LAST_USED_GRANULARITY_MS`.
   * Returns the timestamp the share should carry: the freshly written one, or
   * the recent one the throttle kept. The caller folds it back into the row, so
   * the resolved share reports exactly what the next listing will.
   */
  const recordUse = (row: ShareRow, now: number): number => {
    const previous = row.last_used_at ?? null;
    if (previous !== null && now - previous < SHARE_LAST_USED_GRANULARITY_MS) return previous;
    touchLastUsed.run(now, row.id);
    return now;
  };

  return {
    create: (input) => {
      const problem = validateShareInput(input);
      if (problem) throw new Error(problem);

      const id = randomUUID();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const workspaceId = input.workspaceId.trim();
      const roomId = shareRoomId(input.scope, workspaceId, token);
      const cardIds = input.scope === "selection" ? normalizeCardIds(input.cardIds).cardIds : [];
      // Derived once, here: the address a reader holds never moves because a
      // card was renamed later.
      const slug = uniqueSlug(workspaceId, shareSlugBase(input.name, input.scope));
      insert.run(
        id,
        hashShareToken(token),
        input.scope,
        input.role,
        workspaceId,
        normalizeId(input.boardId),
        normalizeId(input.startBoardId),
        normalizeId(input.cardId),
        Date.now(),
        input.expiresAt ?? null,
        roomId,
        JSON.stringify(cardIds),
        slug,
      );
      const share = get(id);
      if (!share) throw new Error("The share could not be created.");
      return { token, share: { ...share, roomId } };
    },

    resolve: (token) => {
      if (token.length === 0) return null;
      const row = selectByHash.get(hashShareToken(token)) as ShareRow | undefined;
      if (!row || row.revoked_at != null) return null;
      if (row.expires_at != null && row.expires_at <= Date.now()) return null;
      row.last_used_at = recordUse(row, Date.now());
      return toShare(row, token);
    },

    isShareToken: (token) =>
      token.length > 0 && countByHash.get(hashShareToken(token)) !== undefined,

    createSession: (share, ttlMs = SHARE_SESSION_TTL_MS) => {
      const session = randomBytes(SESSION_BYTES).toString("base64url");
      const now = Date.now();
      const expiresAt = now + (Number.isFinite(ttlMs) ? ttlMs : SHARE_SESSION_TTL_MS);
      // A row created before the room id column existed has none stored; the
      // share that was just resolved knows its room, so keep it while a session
      // can hand that room to a WebSocket join.
      if (share.roomId !== null) backfillRoomId.run(share.roomId, share.id);
      insertSession.run(hashShareSession(session), share.id, now, expiresAt);
      return { session, expiresAt };
    },

    resolveSession: (session) => {
      if (session.length === 0 || session.length > MAX_SESSION_LENGTH) return null;
      const hash = hashShareSession(session);
      const row = selectSession.get(hash) as ShareSessionRow | undefined;
      if (!row) return null;

      const now = Date.now();
      const shareRow = selectById.get(row.share_id) as ShareRow | undefined;
      const dead =
        row.expires_at <= now ||
        !shareRow ||
        shareRow.revoked_at != null ||
        (shareRow.expires_at != null && shareRow.expires_at <= now);
      if (dead) {
        // The session cannot come back: a revoked share never resolves again and
        // an expired one is swept, so drop the row instead of keeping a tombstone.
        deleteSessionByHash.run(hash);
        return null;
      }

      touchSession.run(now + SHARE_SESSION_TTL_MS, hash);
      // Resuming a session is a real use of the link, not a listing.
      shareRow.last_used_at = recordUse(shareRow, now);
      return toShare(shareRow, null);
    },

    deleteSession: (session) => {
      if (session.length === 0 || session.length > MAX_SESSION_LENGTH) return;
      deleteSessionByHash.run(hashShareSession(session));
    },

    get,

    list: (workspaceId) =>
      (selectActive.all(workspaceId) as unknown as ShareRow[]).map((row) => toShare(row, null)),

    listAllActive: () =>
      (selectAllActive.all(Date.now()) as unknown as ShareRow[]).map((row) => toShare(row, null)),

    hasEditorShare: (workspaceId) => selectEditor.get(workspaceId, Date.now()) !== undefined,

    countActive: (workspaceId) => {
      const row = countActiveByWorkspace.get(workspaceId, Date.now()) as
        | { count?: number }
        | undefined;
      return typeof row?.count === "number" ? row.count : 0;
    },

    listExpired: () => {
      // The sweep runs on the same clock: drop session rows that can no longer
      // authenticate so the table only holds live credentials.
      deleteExpiredSessions.run(Date.now());
      return (selectExpired.all(Date.now()) as unknown as ShareRow[]).map((row) =>
        toShare(row, null),
      );
    },

    revoke: (id) => {
      revokeById.run(Date.now(), id);
      // A revoked share is never projected again, so its draft baseline has no
      // reader. Dropping it keeps the table to active shares only.
      deleteBaselineById.run(id);
      // Sessions are credentials for this share only; the link is what was
      // revoked, so every session minted from it dies with it.
      deleteSessionsByShare.run(id);
      return get(id);
    },

    revokeAll: (workspaceId) => {
      const rows = selectActive.all(workspaceId) as unknown as ShareRow[];
      const revoked: Share[] = [];
      const now = Date.now();
      for (const row of rows) {
        revokeById.run(now, row.id);
        deleteBaselineById.run(row.id);
        deleteSessionsByShare.run(row.id);
        const share = get(row.id);
        if (share) revoked.push(share);
      }
      return revoked;
    },

    getBaseline: (shareId) => {
      const row = selectBaseline.get(shareId) as { snapshot?: Uint8Array } | undefined;
      return row?.snapshot ? new Uint8Array(row.snapshot) : null;
    },

    setBaseline: (shareId, snapshot) => {
      upsertBaseline.run(shareId, snapshot, Date.now());
    },

    deleteBaseline: (shareId) => {
      deleteBaselineById.run(shareId);
    },

    close: () => db.close(),
  };
}
