#!/usr/bin/env node
/**
 * Runs the control-plane schema against a real Postgres, then drives the shipped
 * repositories on top of it.
 *
 * Nothing had ever executed `services/auth/sql/*.sql`: a typo, a `timestamptz`
 * column fed epoch milliseconds, or a constraint that was described in a comment
 * but never declared all read the same in review. So this starts a throwaway
 * cluster that cannot collide with anything (unix socket only, a free port for the
 * socket's name), applies every migration in order, asserts the constraints that
 * carry a decision, and then calls the real repositories — the `pg` driver, the
 * real SQL, no fakes.
 *
 * Three outcomes, deliberately different:
 *   - `initdb` absent          → skip with exit 0. Most machines have no Postgres.
 *   - Postgres present, broken → exit 1. A cluster that starts and then refuses the
 *                                schema is exactly the failure this exists to report.
 *   - everything green         → exit 0, one line per assertion.
 *
 * Usage: node scripts/db-verify.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire, register, registerHooks } from "node:module";
import { connect, createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_DIR = join(root, "services/auth/sql");

/**
 * Node strips types from `.ts`, but a `.ts` file that imports `./thing.js` — the
 * specifier style this repo's tsconfig requires — names a file that does not
 * exist. Rewrite that one miss to `.ts` and leave every other resolution alone.
 */
function rewriteTypeScriptImports(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}

if (typeof registerHooks === "function") {
  registerHooks({ resolve: rewriteTypeScriptImports });
} else {
  // Node 22.6–22.14 has only the experimental, module-thread form. Same rule,
  // spelled out again because a loader is imported into its own thread.
  register(
    `data:text/javascript,${encodeURIComponent(
      "export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { " +
        'if (e?.code === "ERR_MODULE_NOT_FOUND" && s.endsWith(".js")) return n(s.slice(0, -3) + ".ts", c); ' +
        "throw e; } }",
    )}`,
  );
}

const typescriptReady =
  process.features.typescript === "strip" ||
  process.features.typescript === "transform" ||
  process.execArgv.includes("--experimental-strip-types");
if (!typescriptReady) {
  // Type stripping is behind a flag on Node 22.6–22.17. Re-run with it rather than
  // making the operator decode an `ERR_UNKNOWN_FILE_EXTENSION` stack trace.
  const rerun = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    { stdio: "inherit" },
  );
  process.exit(rerun.status ?? 1);
}

/**
 * True when the binary is there. Presence is what decides skip-vs-fail: a Postgres
 * that is installed but refuses to run is a broken install, and this script must
 * report that rather than quietly skipping the thing it was asked to check.
 */
function installed(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  return probe.error === undefined || probe.error.code !== "ENOENT";
}

/** Runs a command to completion, turning a failure into the command's own stderr. */
function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : error.message;
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr}`);
  }
}

/** The last lines of a file, for a server that died instead of printing to stderr. */
function tail(path) {
  if (!existsSync(path)) return "(no server log)";
  return readFileSync(path, "utf8").trim().split("\n").slice(-20).join("\n");
}

/**
 * A port nothing else holds. The server listens on a unix socket only, so the port
 * is just the name of the socket file — but a free one keeps a stale socket from a
 * previous run from being mistaken for this one.
 */
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** `true` when a TCP connection is refused, which is the proof the server is socket-only. */
function tcpRefused(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

// ---------------------------------------------------------------- catalogues

const PRIMARY_KEY_SQL = `
  SELECT a.attname AS column_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_index i ON i.indexrelid = c.conindid
  CROSS JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
  WHERE c.contype = 'p'
    AND t.relnamespace = 'public'::regnamespace
    AND t.relname = $1
  ORDER BY key.ord
`;

/** Unique indexes that carry a predicate — the shape a partial unique index has. */
const PARTIAL_UNIQUE_SQL = `
  SELECT a.attname AS column_name,
         i.indisunique AS is_unique,
         i.indpred IS NOT NULL AS is_partial,
         pg_get_expr(i.indpred, i.indrelid) AS predicate
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
  WHERE t.relname = $1
    AND t.relnamespace = 'public'::regnamespace
    AND i.indisunique
    AND i.indpred IS NOT NULL
`;

const CHECK_CONSTRAINTS_SQL = `
  SELECT pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid = to_regclass($1) AND contype = 'c'
`;

const COLUMNS_SQL = `
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
`;

const TABLES_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
`;

/**
 * The columns `services/auth/src/pluginSchema.test.ts` asserts, which is the
 * authority on what the plugins contribute: the test asks Better Auth for the
 * tables its configured instance produces, and this asks the database for the
 * tables the migration actually created.
 */
const PLUGIN_COLUMNS = {
  user: [
    "admittedAt",
    "normalizedEmail",
    "role",
    "banned",
    "banReason",
    "banExpires",
    "twoFactorEnabled",
    "isAnonymous",
  ],
  session: ["impersonatedBy"],
};

const PLUGIN_TABLES = ["twoFactor", "invitation", "member", "passkey"];

/** A column a plugin deliberately does not add; asserted absent, as the test does. */
const ABSENT_COLUMN = { table: "user", column: "lastLoginMethod" };

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

async function main() {
  if (!installed("initdb")) {
    console.log(
      "db verify skipped: initdb is not on PATH, so there is no Postgres to verify against.",
    );
    return 0;
  }
  for (const command of ["pg_ctl", "psql"]) {
    if (!installed(command)) {
      throw new Error(
        `${command} is missing while initdb is present — the Postgres install is incomplete`,
      );
    }
  }

  // Scratch lives inside the repo's gitignored `.scratch/`, not the OS temp dir:
  // the data directory stays visible while a run is going wrong, and nothing this
  // script writes can land somewhere another process is also using.
  const scratch = join(root, ".scratch");
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "db-verify-"));
  const dataDir = join(dir, "data");
  const socketDir = join(dir, "socket");
  const logPath = join(dir, "server.log");
  // initdb and the socket directory both want to be private to this user.
  mkdirSync(socketDir, { mode: 0o700 });

  const port = await freePort();
  let started = false;
  let client = null;

  try {
    run("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres", "--no-sync"]);
    try {
      // `listen_addresses=` (empty) means no TCP listener at all; the socket in
      // `socketDir` is the only way in, so a run cannot talk to, or be reached by,
      // any other database on the machine.
      run("pg_ctl", [
        "-D",
        dataDir,
        "-l",
        logPath,
        "-o",
        `-p ${port} -k ${socketDir} -c listen_addresses=`,
        "start",
      ]);
    } catch (error) {
      throw new Error(`${error.message}\n${tail(logPath)}`);
    }
    started = true;

    const migrations = readdirSync(SQL_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.ok(migrations.length > 0, `no migrations in ${SQL_DIR}`);
    for (const name of migrations) {
      // ON_ERROR_STOP turns the first broken statement into a non-zero exit, so a
      // migration that half-applies is a failure rather than a schema nobody reads.
      run("psql", [
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        socketDir,
        "-p",
        String(port),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-f",
        join(SQL_DIR, name),
      ]);
      console.log(`applied services/auth/sql/${name}`);
    }

    const require = createRequire(join(root, "services/auth/package.json"));
    const { Client } = require("pg");
    client = new Client({ host: socketDir, port, user: "postgres", database: "postgres" });
    await client.connect();

    const query = async (text, values = []) => (await client.query(text, values)).rows;

    const checks = { total: 0, failed: [] };
    /** Runs one assertion, prints one line, and keeps going so a run names every failure. */
    const check = async (name, body) => {
      checks.total += 1;
      try {
        const detail = await body();
        console.log(`ok   ${name}${detail === undefined ? "" : ` — ${detail}`}`);
      } catch (error) {
        checks.failed.push(name);
        console.error(`FAIL ${name}\n     ${error.message.split("\n").join("\n     ")}`);
      }
    };

    await check("the server listens on a unix socket only", async () => {
      assert.ok(await tcpRefused(port), `something accepted TCP on port ${port}`);
      return `socket at ${socketDir}`;
    });

    // --- the constraints that carry a decision --------------------------------

    await check("workspaces.id is the primary key (ADR-0065 §2)", async () => {
      const { rows } = await client.query(PRIMARY_KEY_SQL, ["workspaces"]);
      assert.deepEqual(
        rows.map((row) => row.column_name),
        ["id"],
        "the row's primary key is not the document id alone",
      );
      return "the row's PK is the document id";
    });

    await check('user("normalizedEmail") has a partial unique index (ADR-0067 §9)', async () => {
      const { rows } = await client.query(PARTIAL_UNIQUE_SQL, ["user"]);
      const index = rows.find((row) => row.column_name === "normalizedEmail");
      assert.ok(index, `no unique index on "normalizedEmail"; saw ${JSON.stringify(rows)}`);
      assert.equal(index.is_unique, true);
      // Partial, so the rows that predate the column do not collide on NULL.
      assert.equal(index.is_partial, true);
      assert.match(String(index.predicate), /IS NOT NULL/);
      return index.predicate;
    });

    // `invite_keys` and its redemption function are gone: `better-enrollment` owns
    // invitations now (ADR-0067 §10), so the invariants moved with them. Assert the
    // new ones, because a ceiling that stops being enforced is exactly the kind of
    // regression a schema test exists to catch.
    await check("invite goals: a cap is positive, uses cannot go negative", async () => {
      const { rows } = await client.query(CHECK_CONSTRAINTS_SQL, ["public.invite"]);
      const definitions = rows.map((row) => String(row.definition));
      const cap = definitions.find(
        (def) => /maxUses/i.test(def) && /IS\s+NULL/i.test(def) && />\s*0/.test(def),
      );
      assert.ok(cap, `no maxUses > 0 check; found ${definitions.join(" | ")}`);
      const uses = definitions.find((def) => /useCount/i.test(def) && />=\s*0/.test(def));
      assert.ok(uses, `no useCount >= 0 check; found ${definitions.join(" | ")}`);
      return `${cap} and ${uses}`;
    });

    await check("invite: the token hash is unique and its type is constrained", async () => {
      const { rows } = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'invite'`,
      );
      const unique = rows.find(
        (row) => /UNIQUE/i.test(String(row.indexdef)) && /tokenHash/.test(String(row.indexdef)),
      );
      assert.ok(unique, `no unique token hash index; saw ${JSON.stringify(rows)}`);
      const { rows: types } = await client.query(CHECK_CONSTRAINTS_SQL, ["public.invite"]);
      const typeCheck = types
        .map((row) => String(row.definition))
        .find((def) => /type\s*=\s*ANY/.test(def) && /private/.test(def));
      assert.ok(typeCheck, "no type IN ('private','public') check");
      return String(unique.indexname);
    });

    await check("billing_event.event_id is the primary key", async () => {
      const { rows } = await client.query(PRIMARY_KEY_SQL, ["billing_event"]);
      assert.deepEqual(
        rows.map((row) => row.column_name),
        ["event_id"],
      );
    });

    await check("billing_customer.customer_id is the primary key", async () => {
      const { rows } = await client.query(PRIMARY_KEY_SQL, ["billing_customer"]);
      assert.deepEqual(
        rows.map((row) => row.column_name),
        ["customer_id"],
      );
    });

    // --- the plugin columns ---------------------------------------------------

    const columnRows = await query(COLUMNS_SQL);
    const columns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const [table, expected] of Object.entries(PLUGIN_COLUMNS)) {
      for (const column of expected) {
        await check(`${table}."${column}" exists`, () => {
          assert.ok(
            columns.has(`${table}.${column}`),
            `${table} has no "${column}" column, so the plugin that reads it fails at runtime`,
          );
        });
      }
    }
    await check(`${ABSENT_COLUMN.table}."${ABSENT_COLUMN.column}" is absent`, () => {
      assert.ok(
        !columns.has(`${ABSENT_COLUMN.table}.${ABSENT_COLUMN.column}`),
        `${ABSENT_COLUMN.column} adds login history we decided not to store`,
      );
    });

    const tableRows = await query(TABLES_SQL);
    const tables = new Set(tableRows.map((row) => row.table_name));
    for (const table of PLUGIN_TABLES) {
      await check(`table "${table}" exists`, () => {
        assert.ok(tables.has(table), `the plugin that writes ${table} has nowhere to write`);
      });
    }

    // --- the repositories, on the schema they now share ------------------------

    const { postgresRepositories } = await import(
      pathToFileURL(join(root, "services/auth/src/postgresRepositories.ts")).href
    );
    const { postgresStore } = await import(
      pathToFileURL(join(root, "services/billing/store-postgres.ts")).href
    );

    // Seed the rows Better Auth and the billing webhook would have written. These
    // are plain inserts on purpose: the repositories below read them, and no
    // repository writes a member or a customer.
    await query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [
      "user-1",
      "Ada",
      "ada@example.com",
    ]);
    await query(`INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)`, [
      "org-1",
      "Org One",
      "org-one",
    ]);
    await query(`INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)`, [
      "org-2",
      "Org Two",
      "org-two",
    ]);
    await query(
      `INSERT INTO member (id, "organizationId", "userId", role) VALUES ($1, $2, $3, $4)`,
      ["member-1", "org-1", "user-1", "owner"],
    );
    await query(
      `INSERT INTO organization_licences (
         organization_id, licence_id, tier, workspaces, document_bytes, attachment_bytes, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["org-1", "lic-1", "team", 3, 268_435_456, 1_073_741_824, new Date(NOW + DAY)],
    );

    const repositories = postgresRepositories(client);

    await check("postgresMemberships.roleFor reads the seat Better Auth wrote", async () => {
      assert.equal(await repositories.memberships.roleFor("org-1", "user-1"), "owner");
      // A stranger has no role, which is what a capability map must see.
      assert.equal(await repositories.memberships.roleFor("org-1", "user-2"), null);
    });

    await check("postgresMemberships.countForOrganization counts seats", async () => {
      assert.equal(await repositories.memberships.countForOrganization("org-1"), 1);
      assert.equal(await repositories.memberships.countForOrganization("org-2"), 0);
      assert.equal(await repositories.memberships.countForUser("user-1"), 1);
      return "1 seat in org-1, 0 in org-2";
    });

    await check("postgresLicences.forOrganization returns the projected licence", async () => {
      const licence = await repositories.licences.forOrganization("org-1");
      assert.ok(licence !== null, "an organization with a row read back as unlicensed");
      assert.equal(licence.claims.id, "lic-1");
      assert.equal(licence.claims.tier, "team");
      assert.equal(licence.claims.workspaces, 3);
      assert.equal(licence.claims.expiresAt, NOW + DAY);
      // Fail-closed default: a licence nobody configured seats for admits one person.
      assert.equal(licence.seats, 0);
    });

    await check("postgresLicences projects the signed byte ceilings, not infinity", async () => {
      const licence = await repositories.licences.forOrganization("org-1");
      assert.ok(licence !== null);
      assert.equal(licence.claims.documentBytes, 268_435_456);
      assert.equal(licence.claims.attachmentBytes, 1_073_741_824);
      return "document_bytes and attachment_bytes read as numbers";
    });

    await check("postgresWorkspaces.claim claims an unowned workspace", async () => {
      const claimed = await repositories.workspaces.claim({
        workspaceId: "ws-1",
        organizationId: "org-1",
        name: "Client A",
        now: NOW,
      });
      assert.ok(claimed !== null, "the claim wrote no row");
      // The invariant the feature rests on: the id is the document id, unchanged.
      assert.equal(claimed.workspaceId, "ws-1");
      assert.equal(claimed.organizationId, "org-1");
      assert.equal(claimed.name, "Client A");
      assert.equal(claimed.createdAt, NOW);
      return "id kept, created_at is the epoch millis it was given";
    });

    await check("a second claim by another organization is refused", async () => {
      const stolen = await repositories.workspaces.claim({
        workspaceId: "ws-1",
        organizationId: "org-2",
        name: "Client A",
        now: NOW,
      });
      // Null here is the `workspace-already-claimed` signal the route turns into a 409.
      assert.equal(stolen, null);
      assert.equal(await repositories.workspaces.countForOrganization("org-1"), 1);
      assert.equal(await repositories.workspaces.countForOrganization("org-2"), 0);
    });

    await check("postgresWorkspaces.find carries the organization's members", async () => {
      const found = await repositories.workspaces.find("ws-1");
      assert.ok(found !== null);
      assert.equal(found.organizationId, "org-1");
      assert.deepEqual(
        found.members.map((member) => `${member.userId}:${member.role}`),
        ["user-1:owner"],
      );
      // A `timestamptz` arrives as a `Date`; the repository converts it to millis.
      const createdAt = found.members[0]?.createdAt;
      assert.equal(typeof createdAt, "number");
      assert.ok(Math.abs(Date.now() - createdAt) < DAY, `createdAt ${createdAt} is not recent`);
    });

    await check("postgresStore.getCustomer returns bigint columns as numbers", async () => {
      await query(
        `INSERT INTO billing_customer (
           customer_id, email, tier, price_id, licence, licence_id,
           issued_at, expires_at, subscription_id, last_invoice_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          "cus-1",
          "ada@example.com",
          "team",
          "price_1",
          "token",
          "lic-1",
          NOW,
          NOW + DAY,
          null,
          "in_1",
          NOW,
        ],
      );
      const record = await postgresStore(client).getCustomer("cus-1");
      assert.ok(record !== null);
      assert.equal(record.issuedAt, NOW);
      assert.equal(typeof record.issuedAt, "number");
      assert.equal(record.expiresAt, NOW + DAY);
      assert.equal(record.updatedAt, NOW);
      assert.equal(record.lastInvoiceId, "in_1");
      assert.equal("subscriptionId" in record, false);
      return `${record.issuedAt} is a number, not a string`;
    });

    await check("postgresStore.claimEvent claims a delivery once", async () => {
      // The idempotency claim is the whole of the billing store's correctness, and
      // it is one INSERT whose interval arithmetic only a real server can check.
      const store = postgresStore(client);
      assert.equal(await store.claimEvent("evt-1"), true);
      assert.equal(await store.claimEvent("evt-1"), false);
      const counted = await query(`SELECT count(*)::int AS count FROM billing_event`);
      assert.equal(counted[0]?.count, 1);
      return "the second delivery inserts nothing";
    });

    const [{ server_version: version }] = await query("SHOW server_version");

    if (checks.failed.length > 0) {
      console.error(
        `\ndb verify failed: ${checks.failed.length} of ${checks.total} assertion(s)\n  ${checks.failed.join("\n  ")}`,
      );
      return 1;
    }
    console.log(
      `\ndb verify passed: ${checks.total} assertion(s), ${migrations.length} migration(s), PostgreSQL ${version}.`,
    );
    return 0;
  } finally {
    if (client !== null) {
      try {
        await client.end();
      } catch {
        console.warn("db verify: could not close the client cleanly");
      }
    }
    if (started) {
      try {
        run("pg_ctl", ["-D", dataDir, "stop", "-m", "immediate"]);
      } catch {
        console.warn(`db verify: could not stop the cluster\n${tail(logPath)}`);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(`db verify failed: ${error.message}`);
}
process.exit(code);
