import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AdminPaths,
  adminPaths,
  deleteWorkspace,
  resetOwner,
  roomDocumentKeys,
  runAdmin,
} from "./admin.js";

let directory: string;
let paths: AdminPaths;

function envFor(target: AdminPaths): NodeJS.ProcessEnv {
  return {
    SUITE_DB: target.documents,
    SUITE_SHARES_DB: target.shares,
    SUITE_WORKSPACES_DB: target.workspaces,
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function open(path: string): DatabaseSync {
  return new DatabaseSync(path);
}

function createDocuments(): void {
  const db = open(paths.documents);
  try {
    db.exec(
      `CREATE TABLE documents (
         name TEXT PRIMARY KEY,
         state BLOB NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    );
    const insert = db.prepare("INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)");
    const rows: [string, string][] = [
      ["%LOR:ws-1", "workspace one"],
      ["loro:ws-1", "legacy workspace one"],
      ["%LOR:ws-2", "workspace two"],
    ];
    for (const [name, value] of rows) {
      insert.run(name, Buffer.from(value), Date.now());
    }
  } finally {
    db.close();
  }
}

function createWorkspaces(): void {
  const db = open(paths.workspaces);
  try {
    db.exec(
      `CREATE TABLE workspaces (
         workspace_id TEXT PRIMARY KEY,
         owner_hash TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         claimed_at INTEGER NOT NULL
       )`,
    );
    const insert = db.prepare(
      "INSERT INTO workspaces (workspace_id, owner_hash, created_at, claimed_at) VALUES (?, ?, ?, ?)",
    );
    insert.run("ws-1", hash("owner-key-1"), Date.now(), Date.now());
    insert.run("ws-2", hash("owner-key-2"), Date.now(), Date.now());
  } finally {
    db.close();
  }
}

interface Fixture {
  token: string;
  shareId: string;
}

/** One board share with a baseline plus a projected document, all owned by ws-1. */
function seed(): Fixture {
  createDocuments();
  createWorkspaces();

  const token = "share-token-1";
  const shareId = "share-1";
  const shareDb = open(paths.shares);
  try {
    shareDb.exec(
      `CREATE TABLE shares (
         id TEXT PRIMARY KEY,
         token_hash TEXT NOT NULL UNIQUE,
         scope TEXT NOT NULL,
         role TEXT NOT NULL,
         workspace_id TEXT NOT NULL,
         board_id TEXT,
         card_id TEXT,
         created_at INTEGER NOT NULL,
         revoked_at INTEGER,
         room_id TEXT
       );
       CREATE TABLE share_baselines (
         share_id TEXT PRIMARY KEY,
         snapshot BLOB NOT NULL,
         updated_at INTEGER NOT NULL
       );`,
    );
    shareDb
      .prepare(
        `INSERT INTO shares (id, token_hash, scope, role, workspace_id, board_id, card_id, created_at, revoked_at, room_id)
         VALUES (?, ?, 'board', 'viewer', 'ws-1', 'board-1', NULL, ?, NULL, ?)`,
      )
      .run(shareId, hash(token), Date.now(), `share-${token}`);
    shareDb
      .prepare("INSERT INTO share_baselines (share_id, snapshot, updated_at) VALUES (?, ?, ?)")
      .run(shareId, Buffer.from("draft baseline"), Date.now());
  } finally {
    shareDb.close();
  }

  const documents = open(paths.documents);
  try {
    documents
      .prepare("INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)")
      .run(`%LOR:share-${token}`, Buffer.from("projected board"), Date.now());
  } finally {
    documents.close();
  }

  return { token, shareId };
}

function capture(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

function inspect(): {
  hasOwner: (workspaceId: string) => boolean;
  ownsWorkspace: (workspaceId: string, key: string) => boolean;
  document: (name: string) => string | null;
  shareRevoked: (id: string) => boolean;
  shareExists: (id: string) => boolean;
  shareCount: (workspaceId: string) => number;
  baselineExists: (id: string) => boolean;
  close: () => void;
} {
  const documents = open(paths.documents);
  const workspaces = open(paths.workspaces);
  const shares = open(paths.shares);

  return {
    hasOwner: (workspaceId) =>
      workspaces.prepare("SELECT 1 FROM workspaces WHERE workspace_id = ?").get(workspaceId) !==
      undefined,
    ownsWorkspace: (workspaceId, key) => {
      const row = workspaces
        .prepare("SELECT owner_hash FROM workspaces WHERE workspace_id = ?")
        .get(workspaceId) as { owner_hash: string } | undefined;
      return row?.owner_hash === hash(key);
    },
    document: (name) => {
      const row = documents.prepare("SELECT state FROM documents WHERE name = ?").get(name) as
        | { state: Uint8Array }
        | undefined;
      return row ? new TextDecoder().decode(row.state) : null;
    },
    shareRevoked: (id) => {
      const row = shares.prepare("SELECT revoked_at FROM shares WHERE id = ?").get(id) as
        | { revoked_at: number | null }
        | undefined;
      return row ? row.revoked_at !== null : false;
    },
    shareExists: (id) => shares.prepare("SELECT 1 FROM shares WHERE id = ?").get(id) !== undefined,
    shareCount: (workspaceId) => {
      const row = shares
        .prepare("SELECT COUNT(*) AS count FROM shares WHERE workspace_id = ?")
        .get(workspaceId) as { count: number };
      return row.count;
    },
    baselineExists: (id) =>
      shares.prepare("SELECT 1 FROM share_baselines WHERE share_id = ?").get(id) !== undefined,
    close: () => {
      shares.close();
      workspaces.close();
      documents.close();
    },
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(import.meta.dirname, "..", ".admin-test-"));
  paths = {
    documents: join(directory, "documents.sqlite"),
    shares: join(directory, "shares.sqlite"),
    workspaces: join(directory, "workspaces.sqlite"),
  };
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("admin paths", () => {
  it("matches the server defaults and environment names", () => {
    expect(adminPaths({})).toEqual({
      documents: "suite.documents.sqlite",
      shares: "suite.shares.sqlite",
      workspaces: "suite.workspaces.sqlite",
    });
    expect(adminPaths({ SUITE_DB: "a", SUITE_SHARES_DB: "b", SUITE_WORKSPACES_DB: "c" })).toEqual({
      documents: "a",
      shares: "b",
      workspaces: "c",
    });
  });

  it("knows every key a room may have been stored under", () => {
    expect(roomDocumentKeys("ws-1")).toEqual(["%LOR:ws-1", "loro:ws-1", "NaN:ws-1"]);
  });
});

describe("admin reset-owner", () => {
  it("deletes only the owner row and leaves documents and shares alone", () => {
    const fixture = seed();
    const { lines, log } = capture();

    expect(runAdmin(["reset-owner", "ws-1", "--force"], envFor(paths), log)).toBe(0);

    const state = inspect();
    try {
      expect(state.hasOwner("ws-1")).toBe(false);
      expect(state.ownsWorkspace("ws-2", "owner-key-2")).toBe(true);
      expect(state.document("%LOR:ws-1")).toBe("workspace one");
      expect(state.shareExists(fixture.shareId)).toBe(true);
      expect(state.shareRevoked(fixture.shareId)).toBe(false);
      expect(state.baselineExists(fixture.shareId)).toBe(true);
      expect(state.document(`%LOR:share-${fixture.token}`)).toBe("projected board");
    } finally {
      state.close();
    }
    expect(lines.join("\n")).toContain("Active share links were left unchanged.");
  });

  it("revokes active shares and removes their baselines and projections on request", () => {
    const fixture = seed();
    const { log } = capture();

    resetOwner(paths, "ws-1", { revokeShares: true, log });

    const state = inspect();
    try {
      expect(state.hasOwner("ws-1")).toBe(false);
      expect(state.shareCount("ws-1")).toBe(1);
      expect(state.shareRevoked(fixture.shareId)).toBe(true);
      expect(state.baselineExists(fixture.shareId)).toBe(false);
      expect(state.document(`%LOR:share-${fixture.token}`)).toBeNull();
      expect(state.document(`loro:share-${fixture.token}`)).toBeNull();
      expect(state.document(`NaN:share-${fixture.token}`)).toBeNull();
      // The workspace document is not a share projection and stays.
      expect(state.document("%LOR:ws-1")).toBe("workspace one");
    } finally {
      state.close();
    }
  });
});

describe("admin delete", () => {
  it("removes the workspace document, shares, baselines, projections and owner row", () => {
    const fixture = seed();

    deleteWorkspace(paths, "ws-1");

    const state = inspect();
    try {
      expect(state.hasOwner("ws-1")).toBe(false);
      expect(state.document("%LOR:ws-1")).toBeNull();
      expect(state.document("loro:ws-1")).toBeNull();
      expect(state.document("NaN:ws-1")).toBeNull();
      expect(state.document(`%LOR:share-${fixture.token}`)).toBeNull();
      expect(state.shareExists(fixture.shareId)).toBe(false);
      expect(state.shareCount("ws-1")).toBe(0);
      expect(state.baselineExists(fixture.shareId)).toBe(false);

      // Another workspace is untouched.
      expect(state.ownsWorkspace("ws-2", "owner-key-2")).toBe(true);
      expect(state.document("%LOR:ws-2")).toBe("workspace two");
    } finally {
      state.close();
    }
  });

  it("deletes through the CLI", () => {
    seed();
    const { lines, log } = capture();

    expect(runAdmin(["delete", "ws-1", "--force"], envFor(paths), log)).toBe(0);

    const state = inspect();
    try {
      expect(state.hasOwner("ws-1")).toBe(false);
      expect(state.document("%LOR:ws-1")).toBeNull();
    } finally {
      state.close();
    }
    expect(lines.join("\n")).toContain("is no longer stored on this relay");
  });
});

describe("admin safety", () => {
  it("refuses to run without --force and changes nothing", () => {
    const fixture = seed();
    const { lines, log } = capture();

    expect(runAdmin(["reset-owner", "ws-1"], envFor(paths), log)).not.toBe(0);
    expect(runAdmin(["delete", "ws-1"], envFor(paths), log)).not.toBe(0);

    const state = inspect();
    try {
      expect(state.hasOwner("ws-1")).toBe(true);
      expect(state.shareRevoked(fixture.shareId)).toBe(false);
      expect(state.baselineExists(fixture.shareId)).toBe(true);
      expect(state.document("%LOR:ws-1")).toBe("workspace one");
      expect(state.document(`%LOR:share-${fixture.token}`)).toBe("projected board");
    } finally {
      state.close();
    }
    expect(lines.join("\n")).toContain("Stop the collab server first");
  });

  it("rejects unknown options and missing ids", () => {
    const { lines, log } = capture();

    expect(
      runAdmin(["reset-owner", "ws-1", "--force", "--drop-everything"], envFor(paths), log),
    ).toBe(2);
    expect(runAdmin(["delete", "--force"], envFor(paths), log)).toBe(2);
    expect(runAdmin(["nuke"], envFor(paths), log)).toBe(2);
    expect(lines.join("\n")).toContain("Unknown option: --drop-everything");
  });
});
