import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, WorkspaceDocument } from "@suite/graph";
import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";

const DIR = `${import.meta.dirname}/`;

function reset(name: string): DatabaseSync {
  const path = `${DIR}${name}`;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  return new DatabaseSync(path);
}

// --- documents: pre-tag blob (no `loro-snapshot-v1` prefix), schema 3
{
  const doc = new LoroDoc();
  doc.setPeerId(1n);
  const workspace = new WorkspaceDocument(doc);
  // A Board hangs from a plane, so the fixture names the default View it sits on.
  const view = workspace.ensureView();
  const board = workspace.createBoard({
    id: "board-legacy",
    name: "Legacy board",
    parentBoardId: view.id,
  });
  const one = workspace.createCard({
    id: "card-one",
    boardId: board.id,
    position: { x: 10, y: 20 },
  });
  const two = workspace.createCard({
    id: "card-two",
    boardId: board.id,
    position: { x: 200, y: 60 },
  });
  for (const [cardId, text] of [
    [one.id, "Legacy card one"],
    [two.id, "Legacy card two"],
  ] as const) {
    const title = workspace.getTitle(cardId);
    title.set("nodeName", "doc");
    const blocks = title.getOrCreateContainer("children", new LoroList());
    const paragraph = blocks.insertContainer(0, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.getOrCreateContainer("attributes", new LoroMap());
    const inline = paragraph.getOrCreateContainer("children", new LoroList());
    inline.insertContainer(0, new LoroText()).insert(0, text);
  }
  doc.commit({ origin: "fixture:n-1" });
  // The previous schema number: the document predates this build's stamp.
  doc.getMap(WorkspaceDocument.META_KEY).set("schemaVersion", SCHEMA_VERSION - 1);

  const db = reset("documents.sqlite");
  db.exec(
    `CREATE TABLE documents (name TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at INTEGER NOT NULL);`,
  );
  db.prepare("INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)").run(
    "%LOR:legacy-workspace",
    doc.export({ mode: "snapshot" }),
    1_700_000_000_000,
  );
  db.prepare("INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)").run(
    "%LOR:share-legacy",
    doc.export({ mode: "snapshot" }),
    1_700_000_000_001,
  );
  db.exec("PRAGMA user_version = 0");
  db.close();
}

// --- shares: oldest shape (no room_id / expires_at / card_ids / last_used_at)
{
  const db = reset("shares.sqlite");
  db.exec(`
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL,
      role TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      board_id TEXT,
      card_id TEXT,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX shares_by_workspace ON shares (workspace_id, created_at);
    CREATE TABLE share_baselines (
      share_id TEXT PRIMARY KEY,
      snapshot BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE share_sessions (
      session_hash TEXT PRIMARY KEY,
      share_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX share_sessions_by_share ON share_sessions (share_id);
  `);
  db.prepare(
    `INSERT INTO shares (id, token_hash, scope, role, workspace_id, board_id, card_id, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
  ).run(
    "share-legacy",
    "a".repeat(64),
    "workspace",
    "editor",
    "legacy-workspace",
    1_700_000_000_000,
  );
  db.prepare("INSERT INTO share_baselines (share_id, snapshot, updated_at) VALUES (?, ?, ?)").run(
    "share-legacy",
    new Uint8Array([1, 2, 3, 4]),
    1_700_000_000_000,
  );
  db.close();
}

// --- workspaces: no migration has ever been applied to this table
{
  const db = reset("workspaces.sqlite");
  db.exec(`CREATE TABLE workspaces (
    workspace_id TEXT PRIMARY KEY,
    owner_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    claimed_at INTEGER NOT NULL
  );`);
  db.prepare("INSERT INTO workspaces VALUES (?, ?, ?, ?)").run(
    "legacy-workspace",
    "b".repeat(64),
    1_700_000_000_000,
    1_700_000_000_000,
  );
  db.close();
}

// --- settings: pre-`updated_at`
{
  const db = reset("settings.sqlite");
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("maxWorkspaces", "7");
  db.close();
}

// --- licences: pre-quota_json / email / expires_at
{
  const db = reset("licences.sqlite");
  db.exec(`CREATE TABLE workspace_licences (
    workspace_id TEXT PRIMARY KEY,
    licence_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    claimed_at INTEGER NOT NULL
  );`);
  db.prepare("INSERT INTO workspace_licences VALUES (?, ?, ?, ?)").run(
    "legacy-workspace",
    "lic-legacy",
    "solo",
    1_700_000_000_000,
  );
  db.close();
}

// --- a document store from a newer build than this one
{
  const db = reset("documents-newer.sqlite");
  db.exec(
    `CREATE TABLE documents (name TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at INTEGER NOT NULL);`,
  );
  db.exec("PRAGMA user_version = 99");
  db.close();
}

// --- attachments: the store did not exist in the N-1 shape, so there is no
// file. The test asserts a fresh store is created and reads back empty.
