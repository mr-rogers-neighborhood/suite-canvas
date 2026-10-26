import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AdminPaths,
  adminPaths,
  deleteWorkspace,
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

function createWorkspaceOrgs(): void {
  const db = open(paths.workspaces);
  try {
    // The owner-hash table an older build wrote stays in the file untouched;
    // ADR-0076 ships no migration for issued keys, and the delete must not need
    // one to find what it removes.
    db.exec(
      `CREATE TABLE workspaces (
         workspace_id TEXT PRIMARY KEY,
         owner_hash TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         claimed_at INTEGER NOT NULL
       );
       CREATE TABLE workspace_orgs (
         workspace_id TEXT PRIMARY KEY,
         organization_id TEXT NOT NULL,
         opened_at INTEGER NOT NULL
       )`,
    );
    const insert = db.prepare(
      "INSERT INTO workspace_orgs (workspace_id, organization_id, opened_at) VALUES (?, ?, ?)",
    );
    insert.run("ws-1", "org-a", Date.now());
    insert.run("ws-2", "org-b", Date.now());
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
  createWorkspaceOrgs();

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
  hasOrg: (workspaceId: string) => boolean;
  organizationOf: (workspaceId: string) => string | null;
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
    hasOrg: (workspaceId) =>
      workspaces.prepare("SELECT 1 FROM workspace_orgs WHERE workspace_id = ?").get(workspaceId) !==
      undefined,
    organizationOf: (workspaceId) => {
      const row = workspaces
        .prepare("SELECT organization_id FROM workspace_orgs WHERE workspace_id = ?")
        .get(workspaceId) as { organization_id: string } | undefined;
      return row?.organization_id ?? null;
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
  directory = mkdtempSync(join(import.meta.dirname, "..", "..", ".admin-test-"));
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

describe("admin delete", () => {
  it("removes the workspace document, shares, baselines, projections and organization row", () => {
    const fixture = seed();

    deleteWorkspace(paths, "ws-1");

    const state = inspect();
    try {
      expect(state.hasOrg("ws-1")).toBe(false);
      expect(state.document("%LOR:ws-1")).toBeNull();
      expect(state.document("loro:ws-1")).toBeNull();
      expect(state.document("NaN:ws-1")).toBeNull();
      expect(state.document(`%LOR:share-${fixture.token}`)).toBeNull();
      expect(state.shareExists(fixture.shareId)).toBe(false);
      expect(state.shareCount("ws-1")).toBe(0);
      expect(state.baselineExists(fixture.shareId)).toBe(false);

      // Another workspace is untouched.
      expect(state.organizationOf("ws-2")).toBe("org-b");
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
      expect(state.hasOrg("ws-1")).toBe(false);
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

    expect(runAdmin(["delete", "ws-1"], envFor(paths), log)).not.toBe(0);

    const state = inspect();
    try {
      expect(state.hasOrg("ws-1")).toBe(true);
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

    expect(runAdmin(["delete", "ws-1", "--force", "--drop-everything"], envFor(paths), log)).toBe(
      2,
    );
    // The owner-key command is gone, so it is an unknown command, not a flag error.
    expect(runAdmin(["reset-owner", "ws-1", "--force"], envFor(paths), log)).toBe(2);
    expect(runAdmin(["delete", "--force"], envFor(paths), log)).toBe(2);
    expect(runAdmin(["nuke"], envFor(paths), log)).toBe(2);
    expect(lines.join("\n")).toContain("Unknown option: --drop-everything");
  });
});
