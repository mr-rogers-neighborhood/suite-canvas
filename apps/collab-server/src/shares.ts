import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const shareScopes = ["workspace", "board", "card"] as const;
export type ShareScope = (typeof shareScopes)[number];

export const shareRoles = ["viewer", "editor"] as const;
export type ShareRole = (typeof shareRoles)[number];

/** Room prefix for shares that do not open a whole workspace room. */
export const SHARE_ROOM_PREFIX = "share-";

export interface Share {
  id: string;
  scope: ShareScope;
  role: ShareRole;
  workspaceId: string;
  boardId: string | null;
  cardId: string | null;
  createdAt: number;
  revokedAt: number | null;
  /** Epoch milliseconds; null means the link does not expire. */
  expiresAt: number | null;
  /**
   * Sync room this share opens. Workspace shares open the workspace room. Board
   * and card shares open `share-<token>`; because only the token hash is stored,
   * the room id is persisted on create so the projection worker can rebuild a
   * share without ever seeing the token. Rows written before the room id column
   * existed have `roomId: null` until they are resolved with their token.
   */
  roomId: string | null;
}

export interface CreateShareInput {
  workspaceId: string;
  scope: ShareScope;
  role: ShareRole;
  boardId?: string | null;
  cardId?: string | null;
  expiresAt?: number | null;
}

export interface CreatedShare {
  /** Raw capability token. Never persisted; the store only keeps its SHA-256 hash. */
  token: string;
  share: Share;
}

export interface ShareStore {
  create: (input: CreateShareInput) => CreatedShare;
  /** Active share for a raw token, or null when unknown or revoked. */
  resolve: (token: string) => Share | null;
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
const MAX_ID_LENGTH = 512;

interface ShareRow {
  id: string;
  scope: string;
  role: string;
  workspace_id: string;
  board_id: string | null;
  card_id: string | null;
  created_at: number;
  revoked_at: number | null;
  expires_at: number | null;
  /** Null on rows created before the column existed; `create` always fills it. */
  room_id: string | null;
}

export function shareRoomId(scope: ShareScope, workspaceId: string, token: string): string {
  return scope === "workspace" ? workspaceId : `${SHARE_ROOM_PREFIX}${token}`;
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function normalizeId(value: unknown): string | null {
  return isId(value) ? value.trim() : null;
}

/** Validates a create payload; returns a human-readable problem, or null when valid. */
export function validateShareInput(input: {
  workspaceId?: unknown;
  scope?: unknown;
  role?: unknown;
  boardId?: unknown;
  cardId?: unknown;
  expiresAt?: unknown;
}): string | null {
  if (!isId(input.workspaceId)) return "A workspace id is required.";
  if (!shareScopes.includes(input.scope as ShareScope)) {
    return "Scope must be workspace, board or card.";
  }
  if (!shareRoles.includes(input.role as ShareRole)) {
    return "Role must be viewer or editor.";
  }

  const scope = input.scope as ShareScope;
  const boardId = normalizeId(input.boardId);
  const cardId = normalizeId(input.cardId);
  if (input.boardId != null && !boardId) return "The board id must be a non-empty string.";
  if (input.cardId != null && !cardId) return "The card id must be a non-empty string.";
  if (input.expiresAt != null) {
    if (
      typeof input.expiresAt !== "number" ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= Date.now()
    ) {
      return "The expiry must be a future timestamp.";
    }
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
  }
}

function toShare(row: ShareRow, token: string | null): Share {
  const scope = row.scope as ShareScope;
  const storedRoom = row.room_id ?? null;
  let roomId = storedRoom;
  if (scope === "workspace") roomId = storedRoom ?? row.workspace_id;
  else if (!roomId && token) roomId = shareRoomId(scope, row.workspace_id, token);
  return {
    id: row.id,
    scope,
    role: row.role as ShareRole,
    workspaceId: row.workspace_id,
    boardId: row.board_id ?? null,
    cardId: row.card_id ?? null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
    expiresAt: row.expires_at ?? null,
    roomId,
  };
}

/**
 * Adds the room id column to a store created before it existed. Older board and
 * card rows keep a null room id, which only affects projections that were never
 * rebuilt; `resolve` still derives the room from the token.
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
}

export function createShareStore(path: string): ShareStore {
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS shares (
       id TEXT PRIMARY KEY,
       token_hash TEXT NOT NULL UNIQUE,
       scope TEXT NOT NULL,
       role TEXT NOT NULL,
       workspace_id TEXT NOT NULL,
       board_id TEXT,
       card_id TEXT,
       created_at INTEGER NOT NULL,
       revoked_at INTEGER,
       expires_at INTEGER,
       room_id TEXT
     );
     CREATE INDEX IF NOT EXISTS shares_by_workspace ON shares (workspace_id, created_at);
     CREATE TABLE IF NOT EXISTS share_baselines (
       share_id TEXT PRIMARY KEY,
       snapshot BLOB NOT NULL,
       updated_at INTEGER NOT NULL
     );`,
  );
  migrateShareColumns(db);

  const insert = db.prepare(
    `INSERT INTO shares (id, token_hash, scope, role, workspace_id, board_id, card_id, created_at, revoked_at, expires_at, room_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
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
  const selectBaseline = db.prepare("SELECT snapshot FROM share_baselines WHERE share_id = ?");
  const upsertBaseline = db.prepare(
    `INSERT INTO share_baselines (share_id, snapshot, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(share_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
  );
  const deleteBaselineById = db.prepare("DELETE FROM share_baselines WHERE share_id = ?");

  const get = (id: string): Share | null => {
    const row = selectById.get(id) as ShareRow | undefined;
    return row ? toShare(row, null) : null;
  };

  return {
    create: (input) => {
      const problem = validateShareInput(input);
      if (problem) throw new Error(problem);

      const id = randomUUID();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const workspaceId = input.workspaceId.trim();
      const roomId = shareRoomId(input.scope, workspaceId, token);
      insert.run(
        id,
        hashShareToken(token),
        input.scope,
        input.role,
        workspaceId,
        normalizeId(input.boardId),
        normalizeId(input.cardId),
        Date.now(),
        input.expiresAt ?? null,
        roomId,
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
      return toShare(row, token);
    },

    isShareToken: (token) =>
      token.length > 0 && countByHash.get(hashShareToken(token)) !== undefined,

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

    listExpired: () =>
      (selectExpired.all(Date.now()) as unknown as ShareRow[]).map((row) => toShare(row, null)),

    revoke: (id) => {
      revokeById.run(Date.now(), id);
      // A revoked share is never projected again, so its draft baseline has no
      // reader. Dropping it keeps the table to active shares only.
      deleteBaselineById.run(id);
      return get(id);
    },

    revokeAll: (workspaceId) => {
      const rows = selectActive.all(workspaceId) as unknown as ShareRow[];
      const revoked: Share[] = [];
      const now = Date.now();
      for (const row of rows) {
        revokeById.run(now, row.id);
        deleteBaselineById.run(row.id);
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
