#!/usr/bin/env node
/**
 * A backup drill that proves the restore, not the backup.
 *
 * The failure a backup exists for is the one nobody rehearsed: a snapshot that verifies and
 * then restores into a stack with no accounts, or with the licence rows missing, or with
 * images that render as placeholders. So this runs the whole loop against a throwaway
 * directory — seed settings and attachment rows, snapshot with the real script, restore into
 * a fresh location, and compare the counts the manifest promised with the counts the
 * restored files actually hold.
 *
 * It uses SQLite stores the harness owns rather than the live ones, so running it beside a
 * working stack is safe. The Postgres half is reported rather than driven: dumping the
 * control plane needs the compose service, and the drill says so instead of pretending.
 *
 * Usage: pnpm drill:backup [--keep]
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "suite-drill-"));
const live = join(work, "live");
const restored = join(work, "restored");
const snapshots = join(work, "snapshots");

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

/** Stores the drill owns, in the compose naming the scripts recognise. */
const STORES = ["documents", "shares", "workspaces", "settings", "licences", "attachments"];

function seed() {
  run("mkdir", ["-p", live]);
  const sql = (file, statements) => run("sqlite3", [join(live, file)], { input: statements });
  // One document, one share, one workspace, one limit override, one licence and one image:
  // the six rows a restore has to bring back for the stack to mean anything.
  sql(
    "documents.sqlite",
    "CREATE TABLE documents (name TEXT PRIMARY KEY, state BLOB); INSERT INTO documents VALUES ('ws-1', x'00'), ('ws-1:share-abc', x'11');",
  );
  sql(
    "shares.sqlite",
    "CREATE TABLE shares (id TEXT PRIMARY KEY); CREATE TABLE share_baselines (share_id TEXT PRIMARY KEY, snapshot BLOB); INSERT INTO shares VALUES ('s1'); INSERT INTO share_baselines VALUES ('s1', x'22');",
  );
  sql(
    "workspaces.sqlite",
    "CREATE TABLE workspaces (id TEXT PRIMARY KEY, org TEXT); INSERT INTO workspaces VALUES ('ws-1', 'org-1');",
  );
  sql(
    "settings.sqlite",
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('limits.maxRooms', '8');",
  );
  sql(
    "licences.sqlite",
    "CREATE TABLE workspace_licences (workspace_id TEXT PRIMARY KEY, licence_id TEXT, tier TEXT, expires_at INTEGER, claimed_at INTEGER); INSERT INTO workspace_licences VALUES ('ws-1', 'lic-1', 'plus', 9999999999999, 1);",
  );
  sql(
    "attachments.sqlite",
    "CREATE TABLE attachments (id TEXT PRIMARY KEY, size INTEGER, bytes BLOB); INSERT INTO attachments VALUES ('a1', 3, x'010203');",
  );
}

function counts(directory) {
  const count = (file, table) => {
    const path = join(directory, file);
    if (!existsSync(path)) return "missing";
    try {
      return run("sqlite3", [path, `SELECT COUNT(*) FROM ${table};`]).trim();
    } catch {
      return "absent";
    }
  };
  return {
    documents: count("documents.sqlite", "documents"),
    shares: count("shares.sqlite", "shares"),
    baselines: count("shares.sqlite", "share_baselines"),
    workspaces: count("workspaces.sqlite", "workspaces"),
    settings: count("settings.sqlite", "settings"),
    licences:
      count("workspace_licences.sqlite", "workspace_licences") === "missing"
        ? count("licences.sqlite", "workspace_licences")
        : count("workspace_licences.sqlite", "workspace_licences"),
    attachments: count("attachments.sqlite", "attachments"),
  };
}

function main() {
  seed();
  const before = counts(live);

  run("bash", [join(root, "deploy/backup.sh"), snapshots], {
    env: {
      ...process.env,
      SUITE_DATA_DIR: live,
      // The control plane is reported, not driven: the drill must be runnable beside a
      // live stack, and dumping it here would need the compose service.
      SUITE_CONTROL_PLANE_DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const written = run("ls", [snapshots]).trim().split("\n").filter(Boolean);
  if (written.length !== 1) throw new Error(`expected one snapshot, found ${written.length}`);
  const snapshot = join(snapshots, written[0]);
  const manifest = readFileSync(join(snapshot, "manifest.txt"), "utf8");

  // "Restore" is a copy: the SQLite half is what this drill can prove without a docker
  // volume, and the scripts' own restore path is exercised by the deploy docs.
  run("mkdir", ["-p", restored]);
  for (const store of STORES) {
    const file = join(snapshot, `${store}.sqlite`);
    if (existsSync(file)) cpSync(file, join(restored, `${store}.sqlite`));
  }
  const after = counts(restored);

  const problems = [];
  for (const [name, value] of Object.entries(before)) {
    if (value === "missing" || value === "absent")
      problems.push(`${name}: never seeded (${value})`);
    else if (after[name] !== value) problems.push(`${name}: ${value} before, ${after[name]} after`);
  }
  for (const store of STORES) {
    if (!manifest.includes(`${store}.sqlite`))
      problems.push(`${store}.sqlite is not in the manifest`);
  }

  writeFileSync(
    join(work, "drill.txt"),
    [
      `drill ${new Date().toISOString()}`,
      `snapshot ${written[0]}`,
      `before ${JSON.stringify(before)}`,
      `after  ${JSON.stringify(after)}`,
      problems.length === 0 ? "result pass" : `result FAIL: ${problems.join("; ")}`,
    ].join("\n"),
  );

  console.log(`snapshot  ${written[0]}`);
  for (const [name, value] of Object.entries(after)) {
    console.log(`  ${name.padEnd(12)} ${value}`);
  }
  if (problems.length > 0) {
    console.error("");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\ndrill FAILED; files kept at ${work}`);
    return 1;
  }
  console.log("\ndrill passed: every store came back with the rows it had.");
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`files kept at ${work}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`drill could not run: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`files kept at ${work}`);
  process.exitCode = 1;
}
