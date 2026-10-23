import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CreateShareInput,
  createShareStore,
  MAX_SELECTION_CARDS,
  type ShareRole,
  type ShareScope,
  type ShareStore,
} from "./shares.js";

let directory: string;
let path: string;
let store: ShareStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-shares-"));
  path = join(directory, "shares.sqlite");
  store = createShareStore(path);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("share store", () => {
  it("creates a workspace editor share with a token and a workspace room", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "editor",
    });

    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(share.workspaceId).toBe("ws-1");
    expect(share.scope).toBe("workspace");
    expect(share.role).toBe("editor");
    expect(share.roomId).toBe("ws-1");
    expect(share.revokedAt).toBeNull();
    expect(share.boardId).toBeNull();
    expect(share.cardId).toBeNull();
  });

  it("derives a per-token room for board and card shares", () => {
    const board = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const card = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      boardId: "board-1",
      cardId: "card-1",
    });

    expect(board.share.roomId).toBe(`share-${board.token}`);
    expect(card.share.roomId).toBe(`share-${card.token}`);
    expect(board.share.boardId).toBe("board-1");
    expect(card.share.cardId).toBe("card-1");
  });

  it("stores only the hashed token", () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    const db = new DatabaseSync(path);
    const rows = db.prepare("SELECT * FROM shares").all();
    db.close();

    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows).toHaveLength(1);
    const [row] = rows as { token_hash?: string }[];
    expect(row?.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("issues a distinct token per share", () => {
    const first = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const second = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    expect(first.token).not.toBe(second.token);
    expect(first.share.id).not.toBe(second.share.id);
  });

  it("resolves a token to the same share", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      cardId: "card-1",
    });

    const resolved = store.resolve(token);

    expect(resolved?.id).toBe(share.id);
    expect(resolved?.roomId).toBe(share.roomId);
    expect(resolved?.cardId).toBe("card-1");
  });

  it("returns null for unknown and empty tokens", () => {
    expect(store.resolve("not-a-token")).toBeNull();
    expect(store.resolve("")).toBeNull();
  });

  it("lists only active shares of one workspace, newest first", () => {
    const older = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const newer = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    store.create({ workspaceId: "ws-2", scope: "workspace", role: "editor" });

    const ids = store.list("ws-1").map((share) => share.id);

    expect(ids).toEqual([newer.share.id, older.share.id]);
    expect(ids).not.toContain("ws-2");
  });

  it("keeps every room id on listed shares", () => {
    store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const created = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });

    const [board, workspace] = store.list("ws-1");

    expect(workspace?.roomId).toBe("ws-1");
    // The projection room is persisted so the worker can rebuild without the token.
    expect(board?.roomId).toBe(`share-${created.token}`);
    expect(board?.roomId).toBe(created.share.roomId);
  });

  it("lists active shares across workspaces for the projection worker", () => {
    const first = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      cardId: "card-1",
    });
    const second = store.create({ workspaceId: "ws-2", scope: "workspace", role: "editor" });
    const revoked = store.create({
      workspaceId: "ws-2",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    store.revoke(revoked.share.id);

    const all = store.listAllActive();

    expect(all.map((share) => share.id)).toEqual([second.share.id, first.share.id]);
    expect(all[1]?.roomId).toBe(`share-${first.token}`);
  });

  it("revokes a share so it no longer resolves or lists", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "editor",
    });

    const revoked = store.revoke(share.id);

    expect(revoked?.revokedAt).toBeTypeOf("number");
    expect(store.resolve(token)).toBeNull();
    expect(store.list("ws-1")).toHaveLength(0);
    expect(store.get(share.id)?.revokedAt).toBeTypeOf("number");
  });

  it("returns null when revoking an unknown share", () => {
    expect(store.revoke("missing")).toBeNull();
  });

  it("recognizes a revoked token as a share token but not as an active one", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "editor",
    });
    store.revoke(share.id);

    expect(store.isShareToken(token)).toBe(true);
    expect(store.resolve(token)).toBeNull();
    expect(store.isShareToken("not-a-token")).toBe(false);
    expect(store.isShareToken("")).toBe(false);
  });

  it("creates, resolves and lists a workspace viewer link", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
    });

    expect(share.role).toBe("viewer");
    // A workspace viewer joins the real workspace room; there is no projection.
    expect(share.roomId).toBe("ws-1");
    expect(store.resolve(token)).toMatchObject({ id: share.id, role: "viewer" });
    expect(store.list("ws-1").map((entry) => entry.id)).toEqual([share.id]);
    expect(store.listAllActive().map((entry) => entry.id)).toEqual([share.id]);
  });

  it("rejects invalid scope, role and targets", () => {
    expect(() => store.create({ workspaceId: "", scope: "workspace", role: "editor" })).toThrow(
      "workspace id",
    );
    expect(() =>
      store.create({ workspaceId: "ws-1", scope: "folder" as ShareScope, role: "viewer" }),
    ).toThrow("Scope");
    expect(() =>
      store.create({ workspaceId: "ws-1", scope: "workspace", role: "owner" as ShareRole }),
    ).toThrow("Role");
    expect(() => store.create({ workspaceId: "ws-1", scope: "board", role: "viewer" })).toThrow(
      "board id",
    );
    expect(() => store.create({ workspaceId: "ws-1", scope: "card", role: "viewer" })).toThrow(
      "card id",
    );
    expect(() =>
      store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor", boardId: "board-1" }),
    ).toThrow("do not take a board");
  });

  it("keeps board and card editor shares creatable for the next phase", () => {
    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    expect(share.role).toBe("editor");
  });

  it("round-trips the cards of a selection share in order", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: ["card-2", "card-1", " card-2 ", "card-3"],
    });

    // Repeated ids are dropped and the owner's order survives.
    expect(share.cardIds).toEqual(["card-2", "card-1", "card-3"]);
    expect(share.cardCount).toBe(3);
    expect(share.roomId).toBe(`share-${token}`);
    expect(store.resolve(token)?.cardIds).toEqual(["card-2", "card-1", "card-3"]);
    expect(store.get(share.id)?.cardCount).toBe(3);
  });

  it("leaves the card list empty on every other scope", () => {
    const workspace = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const board = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const card = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      cardId: "card-1",
    });

    expect(workspace.share.cardIds).toEqual([]);
    expect(workspace.share.cardCount).toBe(0);
    expect(board.share.cardIds).toEqual([]);
    expect(board.share.cardCount).toBe(0);
    expect(card.share.cardIds).toEqual([]);
    expect(card.share.cardCount).toBe(1);
  });

  it("caps a selection at the maximum number of cards", () => {
    const atCap = Array.from({ length: MAX_SELECTION_CARDS }, (_, index) => `card-${index}`);
    const overCap = [...atCap, "card-extra"];

    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: atCap,
    });
    expect(share.cardCount).toBe(MAX_SELECTION_CARDS);

    expect(() =>
      store.create({
        workspaceId: "ws-1",
        scope: "selection",
        role: "viewer",
        boardId: "board-1",
        cardIds: overCap,
      }),
    ).toThrow(`at most ${MAX_SELECTION_CARDS} cards`);
  });

  it("rejects a selection without cards", () => {
    const selection: CreateShareInput = {
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "b",
    };

    expect(() => store.create({ ...selection, cardIds: [] })).toThrow("at least one card id");
    expect(() => store.create(selection)).toThrow("at least one card id");
    expect(() => store.create({ ...selection, cardIds: [""] })).toThrow("non-empty string");
  });

  it("rejects an editor selection link", () => {
    expect(() =>
      store.create({
        workspaceId: "ws-1",
        scope: "selection",
        role: "editor",
        boardId: "board-1",
        cardIds: ["card-1"],
      }),
    ).toThrow("Selection links are read-only for now.");
  });

  it("rejects a selection without a board or with a single card id", () => {
    expect(() =>
      store.create({
        workspaceId: "ws-1",
        scope: "selection",
        role: "viewer",
        cardIds: ["card-1"],
      }),
    ).toThrow("board id");
    expect(() =>
      store.create({
        workspaceId: "ws-1",
        scope: "selection",
        role: "viewer",
        boardId: "board-1",
        cardId: "card-1",
        cardIds: ["card-1"],
      }),
    ).toThrow("single card id");
  });

  it("rejects card ids on scopes that project something else", () => {
    expect(() =>
      store.create({
        workspaceId: "ws-1",
        scope: "board",
        role: "viewer",
        boardId: "board-1",
        cardIds: ["card-1"],
      }),
    ).toThrow("Only selection shares take card ids");
    expect(() =>
      store.create({
        workspaceId: "ws-1",
        scope: "workspace",
        role: "viewer",
        cardIds: ["card-1"],
      }),
    ).toThrow("Only selection shares take card ids");
  });

  it("lists the card count of every share", () => {
    store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const selection = store.create({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: ["card-1", "card-2"],
    });

    const listed = store.list("ws-1");

    expect(listed[0]?.id).toBe(selection.share.id);
    expect(listed[0]?.cardIds).toEqual(["card-1", "card-2"]);
    expect(listed.map((share) => share.cardCount)).toEqual([2, 0]);
  });

  it("keeps revoking a selection share unchanged", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: ["card-1"],
    });

    const revoked = store.revoke(share.id);

    expect(revoked?.revokedAt).toBeTypeOf("number");
    expect(revoked?.cardCount).toBe(1);
    expect(store.resolve(token)).toBeNull();
    expect(store.list("ws-1")).toEqual([]);
  });

  it("reads a corrupt card id row as an empty selection", () => {
    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: ["card-1"],
    });

    const db = new DatabaseSync(path);
    db.prepare("UPDATE shares SET card_ids = ? WHERE id = ?").run("{not json", share.id);
    db.close();

    const corrupt = store.get(share.id);
    expect(corrupt?.cardIds).toEqual([]);
    expect(corrupt?.cardCount).toBe(0);

    const object = new DatabaseSync(path);
    object.prepare("UPDATE shares SET card_ids = ? WHERE id = ?").run('{"a":1}', share.id);
    object.close();

    expect(store.get(share.id)?.cardIds).toEqual([]);
  });

  it("survives a reopen", () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const card = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      cardId: "card-1",
    });
    store.close();

    const reopened = createShareStore(path);
    expect(reopened.resolve(token)?.workspaceId).toBe("ws-1");
    expect(reopened.listAllActive().find((share) => share.id === card.share.id)?.roomId).toBe(
      card.share.roomId,
    );
    reopened.close();
    store = createShareStore(path);
  });

  it("adds the room id column to a store created before it existed", () => {
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE shares");
    legacy.exec(
      `CREATE TABLE shares (
         id TEXT PRIMARY KEY,
         token_hash TEXT NOT NULL UNIQUE,
         scope TEXT NOT NULL,
         role TEXT NOT NULL,
         workspace_id TEXT NOT NULL,
         board_id TEXT,
         card_id TEXT,
         created_at INTEGER NOT NULL,
         revoked_at INTEGER
       )`,
    );
    legacy
      .prepare(
        `INSERT INTO shares (id, token_hash, scope, role, workspace_id, board_id, card_id, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run("legacy", "hash", "board", "viewer", "ws-1", "board-1", null, 1);
    legacy.close();

    store = createShareStore(path);

    const legacyShare = store.get("legacy");
    expect(legacyShare?.roomId).toBeNull();
    expect(store.listAllActive().map((share) => share.id)).toEqual(["legacy"]);
    const created = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "b",
    });
    expect(store.get(created.share.id)?.roomId).toBe(`share-${created.token}`);
  });
});

describe("share baselines", () => {
  function editorShare(): string {
    return store.create({ workspaceId: "ws-1", scope: "board", role: "editor", boardId: "b" }).share
      .id;
  }

  it("stores, replaces and deletes a snapshot", () => {
    const shareId = editorShare();

    expect(store.getBaseline(shareId)).toBeNull();

    const first = new Uint8Array([1, 2, 3]);
    store.setBaseline(shareId, first);
    expect(store.getBaseline(shareId)).toEqual(first);

    const second = new Uint8Array([9]);
    store.setBaseline(shareId, second);
    expect(store.getBaseline(shareId)).toEqual(second);

    store.deleteBaseline(shareId);
    expect(store.getBaseline(shareId)).toBeNull();
  });

  it("keeps baselines of revoked shares out of the table", () => {
    const shareId = editorShare();
    store.setBaseline(shareId, new Uint8Array([1]));

    store.revoke(shareId);

    expect(store.getBaseline(shareId)).toBeNull();
  });

  it("survives a reopen", () => {
    const shareId = editorShare();
    store.setBaseline(shareId, new Uint8Array([4, 5]));
    store.close();

    store = createShareStore(path);

    expect(store.getBaseline(shareId)).toEqual(new Uint8Array([4, 5]));
  });

  it("creates the baseline table for a store built before it existed", () => {
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE share_baselines");
    legacy.close();

    store = createShareStore(path);
    const shareId = editorShare();
    store.setBaseline(shareId, new Uint8Array([7]));

    expect(store.getBaseline(shareId)).toEqual(new Uint8Array([7]));
  });
});

describe("share expiry and bulk revoke", () => {
  it("resolves a share until it expires and hides it from the worker list", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { token } = store.create({
        workspaceId: "ws-1",
        scope: "workspace",
        role: "viewer",
        expiresAt: Date.now() + 60_000,
      });
      expect(store.resolve(token)?.expiresAt).toBe(Date.now() + 60_000);

      vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
      expect(store.resolve(token)).toBeNull();
      expect(store.listAllActive()).toEqual([]);
      expect(store.countActive("ws-1")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("revokes every active share of a workspace", () => {
    const first = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const second = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "b-1",
    });
    store.create({ workspaceId: "ws-2", scope: "workspace", role: "viewer" });

    const revoked = store.revokeAll("ws-1");
    expect(revoked.map((share) => share.id).sort()).toEqual(
      [first.share.id, second.share.id].sort(),
    );
    expect(store.list("ws-1")).toEqual([]);
    expect(store.resolve(first.token)).toBeNull();
    expect(store.resolve(second.token)).toBeNull();
  });
});

describe("share sessions", () => {
  function boardShare() {
    return store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
  }

  function sessionRows(): Record<string, unknown>[] {
    const db = new DatabaseSync(path);
    const rows = db.prepare("SELECT * FROM share_sessions").all() as Record<string, unknown>[];
    db.close();
    return rows;
  }

  it("mints a session that resolves to its share and room", () => {
    const { share } = boardShare();

    const { session, expiresAt } = store.createSession(share);

    expect(session.length).toBeGreaterThanOrEqual(32);
    expect(expiresAt).toBeGreaterThan(Date.now());
    const resolved = store.resolveSession(session);
    expect(resolved?.id).toBe(share.id);
    expect(resolved?.roomId).toBe(share.roomId);
    expect(resolved?.role).toBe("viewer");
  });

  it("issues a distinct session per exchange", () => {
    const { share } = boardShare();

    const first = store.createSession(share);
    const second = store.createSession(share);

    expect(first.session).not.toBe(second.session);
    expect(store.resolveSession(first.session)?.id).toBe(share.id);
    expect(store.resolveSession(second.session)?.id).toBe(share.id);
  });

  it("stores only the hashed session", () => {
    const { share } = boardShare();
    const { session } = store.createSession(share);

    const rows = sessionRows();

    expect(JSON.stringify(rows)).not.toContain(session);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_hash).toBe(createHash("sha256").update(session).digest("hex"));
    expect(rows[0]?.share_id).toBe(share.id);
  });

  it("slides the expiry on each successful use", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { share } = boardShare();
      const { session } = store.createSession(share);

      vi.setSystemTime(new Date("2026-01-01T00:14:00.000Z"));
      expect(store.resolveSession(session)?.id).toBe(share.id);

      // Used at +14m, so the session now lasts until +29m even though the
      // window from creation would have ended at +15m.
      vi.setSystemTime(new Date("2026-01-01T00:28:00.000Z"));
      expect(store.resolveSession(session)?.id).toBe(share.id);

      // Last use was +28m, so the window closes at +43m: it is idleness, not age,
      // that ends a session.
      vi.setSystemTime(new Date("2026-01-01T00:44:00.000Z"));
      expect(store.resolveSession(session)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops resolving an expired session and drops its row", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { share } = boardShare();
      const { session } = store.createSession(share, 60_000);

      vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
      expect(store.resolveSession(session)).toBeNull();
      expect(sessionRows()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never outlives its share expiry", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const { share } = store.create({
        workspaceId: "ws-1",
        scope: "board",
        role: "viewer",
        boardId: "board-1",
        expiresAt: Date.now() + 60_000,
      });
      const { session } = store.createSession(share);
      expect(store.resolveSession(session)?.id).toBe(share.id);

      vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
      expect(store.resolveSession(session)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops every session when its share is revoked", () => {
    const { share } = boardShare();
    const first = store.createSession(share);
    const second = store.createSession(share);

    store.revoke(share.id);

    expect(store.resolveSession(first.session)).toBeNull();
    expect(store.resolveSession(second.session)).toBeNull();
    expect(sessionRows()).toEqual([]);
  });

  it("drops every session on a bulk revoke", () => {
    const first = boardShare();
    const second = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      boardId: "board-1",
      cardId: "card-1",
    });
    const other = store.create({ workspaceId: "ws-2", scope: "workspace", role: "viewer" });
    const firstSession = store.createSession(first.share);
    const secondSession = store.createSession(second.share);
    const otherSession = store.createSession(other.share);

    store.revokeAll("ws-1");

    expect(store.resolveSession(firstSession.session)).toBeNull();
    expect(store.resolveSession(secondSession.session)).toBeNull();
    // A session of another workspace is not collateral.
    expect(store.resolveSession(otherSession.session)?.id).toBe(other.share.id);
  });

  it("resolves unknown, empty and corrupt sessions to nothing", () => {
    const { share } = boardShare();
    store.createSession(share);

    expect(store.resolveSession("")).toBeNull();
    expect(store.resolveSession("not-a-session")).toBeNull();
    expect(store.resolveSession("x".repeat(600))).toBeNull();

    // A row whose share no longer exists cannot authenticate anything.
    const db = new DatabaseSync(path);
    db.prepare(
      "INSERT INTO share_sessions (session_hash, share_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      createHash("sha256").update("orphan").digest("hex"),
      "missing-share",
      Date.now(),
      Date.now() + 60_000,
    );
    db.close();
    expect(store.resolveSession("orphan")).toBeNull();
  });

  it("deletes one session without touching the others", () => {
    const { share } = boardShare();
    const kept = store.createSession(share);
    const dropped = store.createSession(share);

    store.deleteSession(dropped.session);

    expect(store.resolveSession(dropped.session)).toBeNull();
    expect(store.resolveSession(kept.session)?.id).toBe(share.id);
    expect(store.deleteSession("")).toBeUndefined();
  });

  it("keeps a session scoped to the share that minted it", () => {
    const first = boardShare();
    const second = store.create({
      workspaceId: "ws-2",
      scope: "workspace",
      role: "editor",
    });
    const session = store.createSession(first.share);

    expect(store.resolveSession(session.session)?.id).toBe(first.share.id);
    expect(store.resolveSession(session.session)?.workspaceId).toBe("ws-1");

    store.revoke(first.share.id);
    expect(store.resolveSession(session.session)).toBeNull();
    expect(store.resolve(second.token)?.id).toBe(second.share.id);
  });

  it("keeps the session table after a reopen", () => {
    const { share } = boardShare();
    const { session } = store.createSession(share);

    store.close();
    store = createShareStore(path);

    expect(store.resolveSession(session)?.id).toBe(share.id);
  });
});
