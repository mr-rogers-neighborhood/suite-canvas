import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_NEEDS_FORCE = 3;

/** Database files the relay uses, each overridable with the same env names. */
export interface AdminPaths {
  documents: string;
  shares: string;
  /** The workspace-to-organization store; the file name predates the rename. */
  workspaces: string;
}

export function adminPaths(env: NodeJS.ProcessEnv = process.env): AdminPaths {
  return {
    documents: env.SUITE_DB ?? "suite.documents.sqlite",
    shares: env.SUITE_SHARES_DB ?? "suite.shares.sqlite",
    workspaces: env.SUITE_WORKSPACES_DB ?? "suite.workspaces.sqlite",
  };
}

/**
 * Keys a room may have been stored under. This mirrors `loroDocumentKeys()` in
 * projectionWorker.ts; the CLI keeps its own copy so it never imports a module
 * that the relay configures at startup.
 */
export function roomDocumentKeys(roomId: string): string[] {
  return [`%LOR:${roomId}`, `loro:${roomId}`, `NaN:${roomId}`];
}

interface ShareRow {
  id: string;
  scope: string;
  room_id: string | null;
}

type Log = (line: string) => void;

function usage(log: Log): void {
  log("Usage:");
  log("  pnpm --filter @suite/collab-server admin delete <workspaceId> [--force]");
  log("");
  log(
    "The command edits the relay's SQLite files, so stop the server first and repeat with --force.",
  );
  log("");
  log("Environment:");
  log("  SUITE_DB             documents database (default: suite.documents.sqlite)");
  log("  SUITE_SHARES_DB      shares database (default: suite.shares.sqlite)");
  log("  SUITE_WORKSPACES_DB  workspace organizations (default: suite.workspaces.sqlite)");
  log("Paths are relative to the current working directory.");
}

function needsForce(command: "delete", workspaceId: string, log: Log): number {
  log("Refusing to change the relay database while the collab server may be running.");
  log(
    "Stop the collab server first (Ctrl-C the `pnpm dev` or `pnpm start` process, or `docker compose stop`).",
  );
  log(`Then re-run: pnpm --filter @suite/collab-server admin ${command} ${workspaceId} --force`);
  return EXIT_NEEDS_FORCE;
}

function withDatabase<T>(path: string, run: (db: DatabaseSync) => T): T | null {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function hasTable(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined;
  return row?.name === table;
}

function shareRows(db: DatabaseSync, workspaceId: string): ShareRow[] {
  if (!hasTable(db, "shares")) return [];
  const columns = db.prepare("PRAGMA table_info(shares)").all() as { name?: string }[];
  const hasRoomId = columns.some((column) => column.name === "room_id");
  const statement = db.prepare(
    hasRoomId
      ? "SELECT id, scope, room_id FROM shares WHERE workspace_id = ?"
      : "SELECT id, scope FROM shares WHERE workspace_id = ?",
  );
  return statement.all(workspaceId) as unknown as ShareRow[];
}

function changes(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

/** Only per-link projection rooms belong to shares; a workspace share uses the workspace room. */
function projectedRoomIds(rows: ShareRow[], workspaceId: string): string[] {
  const rooms = new Set<string>();
  for (const row of rows) {
    if (!row.room_id || row.room_id === workspaceId) continue;
    if (row.room_id.startsWith("share-")) rooms.add(row.room_id);
  }
  return [...rooms];
}

/** Rows created before `room_id` cannot name their projection room any more. */
function legacyRows(rows: ShareRow[]): number {
  return rows.filter((row) => row.scope !== "workspace" && !row.room_id).length;
}

function warnLegacy(log: Log, count: number): void {
  if (count === 0) return;
  log(
    `${count} legacy share row(s) have no recorded room id; their projected document rows cannot be identified.`,
  );
}

interface DocumentDeletion {
  documents: number;
  projected: number;
}

function deleteDocuments(
  db: DatabaseSync,
  workspaceId: string,
  projectionRooms: readonly string[],
): DocumentDeletion {
  if (!hasTable(db, "documents")) return { documents: 0, projected: 0 };
  const remove = db.prepare("DELETE FROM documents WHERE name = ?");
  let documents = 0;
  let projected = 0;

  for (const key of roomDocumentKeys(workspaceId)) {
    documents += changes(remove.run(key));
  }
  for (const roomId of projectionRooms) {
    for (const key of roomDocumentKeys(roomId)) {
      projected += changes(remove.run(key));
    }
  }
  return { documents, projected };
}

/**
 * Deletes everything the relay stores for a workspace: documents, projected
 * share rooms, share rows, draft baselines and the recorded organization.
 */
export function deleteWorkspace(
  paths: AdminPaths,
  workspaceId: string,
  options: { log?: Log } = {},
): { documents: number; projected: number; shares: number; baselines: number; orgRows: number } {
  const log = options.log ?? (() => {});
  const result = { documents: 0, projected: 0, shares: 0, baselines: 0, orgRows: 0 };

  const rows = withDatabase(paths.shares, (db) => shareRows(db, workspaceId)) ?? [];
  const projectionRooms = projectedRoomIds(rows, workspaceId);

  withDatabase(paths.documents, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const deleted = deleteDocuments(db, workspaceId, projectionRooms);
      result.documents = deleted.documents;
      result.projected = deleted.projected;
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  withDatabase(paths.shares, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (hasTable(db, "share_baselines")) {
        result.baselines = changes(
          db
            .prepare(
              "DELETE FROM share_baselines WHERE share_id IN (SELECT id FROM shares WHERE workspace_id = ?)",
            )
            .run(workspaceId),
        );
      }
      result.shares = changes(
        db.prepare("DELETE FROM shares WHERE workspace_id = ?").run(workspaceId),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  withDatabase(paths.workspaces, (db) => {
    if (!hasTable(db, "workspace_orgs")) return;
    result.orgRows = changes(
      db.prepare("DELETE FROM workspace_orgs WHERE workspace_id = ?").run(workspaceId),
    );
  });

  warnLegacy(log, legacyRows(rows));
  log(
    `Deleted ${result.documents} workspace document row(s), including ${result.projected} projected share row(s).`,
  );
  log(`Deleted ${result.shares} share row(s) and ${result.baselines} share draft baseline(s).`);
  log(
    result.orgRows > 0
      ? `Deleted the organization row for workspace ${workspaceId}.`
      : `No organization row existed for workspace ${workspaceId}.`,
  );
  log(`Workspace ${workspaceId} is no longer stored on this relay.`);
  return result;
}

function parseWorkspaceId(value: string | undefined, log: Log): string | null {
  if (!value || value.trim().length === 0 || value.startsWith("--")) {
    log("A workspace id is required.");
    return null;
  }
  return value.trim();
}

/** Runs one admin command and returns its process exit code. */
export function runAdmin(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  log: Log = (line) => process.stdout.write(`${line}\n`),
): number {
  const [command, workspaceArg, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage(log);
    return command ? EXIT_OK : EXIT_USAGE;
  }

  if (command !== "delete") {
    log(`Unknown command: ${command}`);
    usage(log);
    return EXIT_USAGE;
  }

  const workspaceId = parseWorkspaceId(workspaceArg, log);
  if (!workspaceId) {
    usage(log);
    return EXIT_USAGE;
  }

  const allowed = new Set(["--force"]);
  const unknown = rest.find((flag) => !allowed.has(flag));
  if (unknown) {
    log(`Unknown option: ${unknown}`);
    usage(log);
    return EXIT_USAGE;
  }

  const force = rest.includes("--force");

  if (!force) return needsForce(command, workspaceId, log);

  const paths = adminPaths(env);
  log(`Using ${paths.documents}, ${paths.shares} and ${paths.workspaces}.`);

  deleteWorkspace(paths, workspaceId, { log });
  return EXIT_OK;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = runAdmin(process.argv.slice(2));
}
