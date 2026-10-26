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
 * The last block goes one level further, because a repository cannot reach the bug
 * that made this necessary: a brand-new organization was refused its own creator
 * (`seat-refused: licence-missing`) because nothing wrote its `organization_licences`
 * row. Only the real plugin, its real hooks and a real Postgres show that, so the
 * script constructs the auth instance and creates an organization through
 * `auth.api.createOrganization`.
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

/** `null` when the relation does not exist, which is how a dropped table reads. */
const TO_REGCLASS_SQL = `SELECT to_regclass($1)::text AS name`;

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

    await check("subscription.id is the primary key", async () => {
      const { rows } = await client.query(PRIMARY_KEY_SQL, ["subscription"]);
      assert.deepEqual(
        rows.map((row) => row.column_name),
        ["id"],
      );
    });

    // 0008 dropped both tables the hand-written billing function owned. A
    // deployment that still has them is running the retired design, and the
    // entitlement read would be answering from two places.
    for (const retired of ["billing_event", "billing_customer"]) {
      await check(`table "${retired}" is gone`, async () => {
        const { rows } = await client.query(TO_REGCLASS_SQL, [retired]);
        assert.equal(rows[0]?.name, null, `${retired} still exists; ADR-0078 retired it`);
      });
    }

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
      pathToFileURL(join(root, "services/auth/src/store/postgresRepositories.ts")).href
    );

    // Seed the rows Better Auth would have written. These are plain inserts on
    // purpose: the repositories below read them, and no repository writes a
    // member or an organization.
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
    // `organization_licences.organization_id` is the primary key, so a paid licence
    // *replaces* the free row instead of adding a second one: this is the upsert the
    // billing lane's licence write has to be, and 0009 makes the free row the thing it
    // replaces.
    await query(
      `INSERT INTO organization_licences (
         organization_id, licence_id, tier, workspaces, seats, document_bytes, attachment_bytes, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id) DO UPDATE
         SET licence_id = EXCLUDED.licence_id,
             tier = EXCLUDED.tier,
             workspaces = EXCLUDED.workspaces,
             seats = EXCLUDED.seats,
             document_bytes = EXCLUDED.document_bytes,
             attachment_bytes = EXCLUDED.attachment_bytes,
             expires_at = EXCLUDED.expires_at`,
      ["org-1", "lic-1", "team", 3, 0, 268_435_456, 1_073_741_824, new Date(NOW + DAY)],
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

    // --- the free tier, which every organization is born on -------------------

    const { FREE_LICENCE_TIER } = await import(
      pathToFileURL(join(root, "services/auth/src/organizations/freeTier.ts")).href
    );
    const { checkSeatAllowance } = await import(
      pathToFileURL(join(root, "services/auth/src/organizations/seats.ts")).href
    );
    const { licenceStateFor } = await import(
      pathToFileURL(join(root, "services/auth/src/licensing/licences.ts")).href
    );

    await check("creating an organization provisions its free licence (0009)", async () => {
      // org-2 was inserted above, before any repository ran: the trigger on
      // `organization` has to have written the row in that same statement.
      const licence = await repositories.licences.forOrganization("org-2");
      assert.ok(licence !== null, "a new organization has no licence row, so nobody can join it");
      // Every number the free tier names, compared with the object the TypeScript
      // side uses: two descriptions of one tier, and a gate on them drifting.
      assert.equal(licence.claims.tier, FREE_LICENCE_TIER.tier);
      assert.equal(licence.claims.workspaces, FREE_LICENCE_TIER.workspaces);
      assert.equal(licence.seats, FREE_LICENCE_TIER.seats);
      assert.equal(licence.claims.documentBytes, FREE_LICENCE_TIER.documentBytes);
      assert.equal(licence.claims.attachmentBytes, FREE_LICENCE_TIER.attachmentBytes);
      assert.equal(licence.claims.id, "free:org-2");
      const days = Math.round((licence.claims.expiresAt - Date.now()) / DAY);
      assert.ok(
        Math.abs(days - FREE_LICENCE_TIER.days) <= 1,
        `expires_at is ${days} days away, not ${FREE_LICENCE_TIER.days}`,
      );
      return `${licence.claims.tier}: ${licence.claims.workspaces} workspace(s), ${licence.seats} seat(s)`;
    });

    await check("a paid licence replaces the free row rather than adding one", async () => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS count, min(tier) AS tier
         FROM organization_licences WHERE organization_id = $1`,
        ["org-1"],
      );
      assert.equal(rows[0].count, 1, "org-1 holds two licence rows");
      assert.equal(rows[0].tier, "team", "the paid tier did not replace the free one");
      return "one row, tier team";
    });

    await check("the free row admits the owner and refuses a second member", async () => {
      const licence = await repositories.licences.forOrganization("org-2");
      const now = Date.now();
      const decision = (memberCount) =>
        checkSeatAllowance({
          organizationId: "org-2",
          licence: licenceStateFor(true, licence),
          memberCount,
          now,
        });
      assert.deepEqual(decision(1), { ok: true, seat: "licensed-member" });
      assert.deepEqual(decision(2), { ok: false, reason: "seat-allowance-exhausted" });
      return "1 seat allowed, 2 refused as a billing answer";
    });

    await check("no licence row is a named provisioning fault, not a billing refusal", async () => {
      // The state the e2e harness found: an organization with no row at all. 0009 makes
      // it unreachable through the insert path, which is why this one is built by
      // disabling the trigger.
      await query(`ALTER TABLE organization DISABLE TRIGGER organization_free_licence`);
      try {
        await query(`INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)`, [
          "org-unprovisioned",
          "Orphan",
          "orphan",
        ]);
      } finally {
        await query(`ALTER TABLE organization ENABLE TRIGGER organization_free_licence`);
      }
      const licence = await repositories.licences.forOrganization("org-unprovisioned");
      assert.equal(licence, null, "a disabled trigger still wrote a licence row");
      assert.deepEqual(
        checkSeatAllowance({
          organizationId: "org-unprovisioned",
          licence: licenceStateFor(true, licence),
          memberCount: 1,
          now: Date.now(),
        }),
        { ok: false, reason: "licence-unprovisioned" },
      );
    });

    await check("the 0009 backfill gives an older organization the same row", async () => {
      // 0009's last statement is this call for every existing organization; running it
      // again must fill the orphan above and must not disturb a paid row.
      await query(`SELECT provision_free_organization_licence(id) FROM organization`);
      const filled = await repositories.licences.forOrganization("org-unprovisioned");
      assert.ok(filled !== null, "the backfill left the orphan unlicensed");
      assert.equal(filled.claims.tier, FREE_LICENCE_TIER.tier);
      const paid = await repositories.licences.forOrganization("org-1");
      assert.ok(paid !== null);
      assert.equal(paid.claims.tier, "team", "the backfill overwrote a paid licence");
      return "orphan filled, paid row untouched";
    });

    // --- the real plugin, on the real schema ----------------------------------

    await check("an organization created through the plugin can add its first member", async () => {
      // The bug this exists to catch: `beforeAddMember` refuses the creator of a brand
      // new organization with `seat-refused: licence-missing`. Nothing but the real
      // plugin, the real hooks and a real Postgres shows it, so this drives
      // `POST /api/auth/organization/create` the way the app does.
      const { createAuthService } = await import(
        pathToFileURL(join(root, "services/auth/src/identity/betterAuth.ts")).href
      );
      const { authEnvironment } = await import(
        pathToFileURL(join(root, "services/auth/src/http/env.ts")).href
      );
      const { randomBytes } = await import("node:crypto");
      const { postgresDatabase } = await import(
        pathToFileURL(join(root, "services/auth/src/store/postgres.ts")).href
      );

      await query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [
        "user-founder",
        "Grace",
        "grace@example.com",
      ]);

      // The cluster listens on a unix socket only, so the connection string names the
      // socket directory rather than a host:port.
      const database = postgresDatabase({
        connectionString: `postgres://postgres@localhost/postgres?host=${encodeURIComponent(socketDir)}&port=${port}`,
      });
      try {
        const service = createAuthService({
          env: authEnvironment({
            SUITE_AUTH_ENABLED: "1",
            // Better Auth warns about a low-entropy secret, and the warning is noise
            // in a gate that is already green or red.
            SUITE_AUTH_SECRET: randomBytes(32).toString("hex"),
            SUITE_AUTH_URL: "http://localhost:1236",
          }),
          database: database.database,
          licences: repositories.licences,
          memberships: repositories.memberships,
          sendMagicLink: async () => {},
          sendVerificationEmail: async () => {},
          sendOrganizationInvitation: async () => {},
        });

        // `auth.api.*` is the plugin's own server entry point: no request, no cookie,
        // and `userId` names the creator, which is the same code path the HTTP handler
        // reaches with a session. A `Request` through the handler would answer 401,
        // because the plugin only accepts a body-supplied user from a server call.
        const organization = await service.api.createOrganization({
          body: {
            name: "Grace's Agency",
            slug: "graces-agency",
            userId: "user-founder",
          },
        });
        const organizationId = organization.id;
        assert.ok(typeof organizationId === "string" && organizationId.length > 0);

        // The member row is the proof: `beforeAddMember` let the creator through, which
        // is only possible because the licence row existed before the hook ran.
        const seats = await query(
          `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
          [organizationId, "user-founder"],
        );
        assert.deepEqual(
          seats.map((row) => row.role),
          ["owner"],
          "the creator is not a member of the organization they just created",
        );

        const licence = await repositories.licences.forOrganization(organizationId);
        assert.ok(licence !== null, "the plugin's organization has no licence row");
        assert.equal(licence.claims.tier, FREE_LICENCE_TIER.tier);
        assert.equal(licence.seats, FREE_LICENCE_TIER.seats);
        return `organization ${organizationId} created with its owner and a free licence`;
      } finally {
        await database.close();
      }
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

    // --- the account export and erase, on real rows ----------------------------
    //
    // The erase is the one operation in this service that must be all-or-nothing
    // across a dozen tables, and the unit suite cannot prove the SQL: it runs against
    // a memory store. This seeds the shape the route reports on, reads it, erases it,
    // and then asks the tables directly whether the workspace's rows are gone.

    const { postgresAccountStore } = await import(
      pathToFileURL(join(root, "services/auth/src/account/postgres.ts")).href
    );
    const { accountExport } = await import(
      pathToFileURL(join(root, "services/auth/src/account/export.ts")).href
    );
    const { eraseAccount } = await import(
      pathToFileURL(join(root, "services/auth/src/account/erase.ts")).href
    );

    // Two organizations: one the account is alone in, one a colleague also uses. A
    // third person's seat in the shared organization is the row the erase must leave.
    await query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [
      "user-erase",
      "Erasmus",
      "erase@example.com",
    ]);
    await query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [
      "user-other",
      "Ola",
      "ola@example.com",
    ]);
    await query(`INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)`, [
      "org-erase-own",
      "Erasmus Studio",
      "erasmus-studio",
    ]);
    await query(`INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)`, [
      "org-erase-shared",
      "Shared Studio",
      "shared-studio",
    ]);
    for (const [id, organizationId, userId, role] of [
      ["member-erase-own", "org-erase-own", "user-erase", "owner"],
      ["member-erase-shared", "org-erase-shared", "user-erase", "admin"],
      ["member-erase-other", "org-erase-shared", "user-other", "owner"],
    ]) {
      await query(
        `INSERT INTO member (id, "organizationId", "userId", role) VALUES ($1, $2, $3, $4)`,
        [id, organizationId, userId, role],
      );
    }
    await query(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [
      "ws-erase",
      "org-erase-own",
      "Erasmus Q4",
    ]);
    await query(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [
      "ws-other",
      "org-erase-shared",
      "Shared Q4",
    ]);
    await query(`INSERT INTO session (id, "userId", token, "expiresAt") VALUES ($1, $2, $3, $4)`, [
      "session-erase",
      "user-erase",
      "token-erase",
      new Date(NOW + DAY),
    ]);
    await query(
      `INSERT INTO account (id, "userId", "providerId", "accountId") VALUES ($1, $2, $3, $4)`,
      ["credential-erase", "user-erase", "credential", "erase@example.com"],
    );
    await query(
      `INSERT INTO passkey (id, name, "publicKey", "userId", "credentialID", "deviceType")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["passkey-erase", "Laptop", "pk-public", "user-erase", "pk-credential", "singleDevice"],
    );
    await query(
      `INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") VALUES ($1, $2, $3, $4)`,
      ["twofactor-erase", "secret", "codes", "user-erase"],
    );
    await query(
      `INSERT INTO invitation (id, "organizationId", email, role, "expiresAt", "inviterId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        "invitation-erase",
        "org-erase-own",
        "new@example.com",
        "member",
        new Date(NOW + DAY),
        "user-erase",
      ],
    );
    await query(
      `INSERT INTO "invite" (
         id, type, kind, email, role, "tokenHash", mode, "organizationId",
         "createdByUserId", "inviterName", "inviterEmail", "expiresAt",
         "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $12)`,
      [
        "invite-erase",
        "private",
        "org-join",
        "new@example.com",
        "member",
        "hash-erase",
        "private",
        "org-erase-own",
        "user-erase",
        "Erasmus",
        "erase@example.com",
        new Date(NOW + DAY),
      ],
    );
    // The enrollment engine's invitation in an organization that survives, sent by the
    // account being erased: the row carries the inviter's name and address, so it goes
    // with the account even though its organization stays.
    await query(
      `INSERT INTO "invite" (
         id, type, kind, email, role, "tokenHash", mode, "organizationId",
         "createdByUserId", "inviterName", "inviterEmail", "expiresAt",
         "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $12)`,
      [
        "invite-erase-shared",
        "private",
        "org-join",
        "someone@example.com",
        "member",
        "hash-erase-shared",
        "private",
        "org-erase-shared",
        "user-erase",
        "Erasmus",
        "erase@example.com",
        new Date(NOW + DAY),
      ],
    );
    await query(
      `INSERT INTO verification (id, identifier, value, "expiresAt")
       VALUES ($1, $2, $3, $4)`,
      ["verification-erase", "erase@example.com", "token-value", new Date(NOW + DAY)],
    );
    await query(
      `INSERT INTO subscription (id, plan, "referenceId", status) VALUES ($1, $2, $3, $4)`,
      ["subscription-erase", "team", "org-erase-own", "active"],
    );

    // The script holds one `pg` client, so the store is given a `Queryable` over it
    // without a `connect`: `BEGIN` and `COMMIT` then land on that one connection,
    // which is the guarantee a transaction needs and a pool cannot give.
    const accounts = postgresAccountStore({
      query: (text, values) => client.query(text, values),
    });

    await check(
      "postgresAccountStore.read names both organizations and the seat in each",
      async () => {
        const snapshot = await accounts.read("user-erase");
        assert.ok(snapshot !== null, "an account with rows read back as missing");
        assert.equal(snapshot.profile.email, "erase@example.com");
        assert.deepEqual(
          snapshot.organizations.map(
            (organization) =>
              `${organization.organizationId}:${organization.role}:${organization.otherMembers}`,
          ),
          ["org-erase-own:owner:0", "org-erase-shared:admin:1"],
        );
        assert.deepEqual(
          snapshot.workspaces.map((workspace) => workspace.workspaceId),
          ["ws-erase", "ws-other"],
        );
      },
    );

    await check("the export references the document instead of copying it", async () => {
      const document = await accountExport(
        { userId: "user-erase" },
        { accounts, workspaceData: null, now: () => NOW },
      );
      assert.equal(document.format, "suite-account");
      assert.equal(document.exportedAt, NOW);
      const own = document.organizations.find(
        (organization) => organization.organizationId === "org-erase-own",
      );
      assert.ok(own !== undefined, "the organization the account owns is not in the export");
      assert.equal(own.membership.role, "owner");
      assert.equal(typeof own.membership.joinedAt, "number");
      assert.equal(own.workspaces[0]?.workspaceId, "ws-erase");
      assert.equal(own.workspaces[0]?.document.exportedHere, false);
      assert.equal(own.workspaces[0]?.document.exportPath, "/api/admin/workspaces/ws-erase/export");
      // No relay store is wired here, so the file says that instead of "no links".
      assert.match(own.workspaces[0]?.sharesUnavailableReason ?? "", /no relay store/u);
      return "profile, both organizations, the workspace reference and a note for shares";
    });

    const eraseReport = await eraseAccount(
      { userId: "user-erase" },
      { accounts, workspaceData: null, now: () => NOW },
    );

    await check(
      "the erase deletes the account's own organization and every row under it",
      async () => {
        assert.equal(
          eraseReport.deleted,
          true,
          `the erase did not commit: ${JSON.stringify(eraseReport.stores.filter((store) => store.reason).map((store) => store.reason))}`,
        );
        const remaining = await query(
          `SELECT id FROM workspaces WHERE id IN ('ws-erase', 'ws-other') ORDER BY id`,
        );
        // The workspace row is the one the report's `workspaces` count is about: it is
        // gone, and the colleague's is not.
        assert.deepEqual(
          remaining.map((row) => row.id),
          ["ws-other"],
        );
        for (const [table, column, value] of [
          ["workspaces", "id", "ws-erase"],
          ["organization", "id", "org-erase-own"],
          ["member", "id", "member-erase-own"],
          ["invite", "id", "invite-erase"],
          ["invite", "id", "invite-erase-shared"],
          ["invitation", "id", "invitation-erase"],
          ["verification", "id", "verification-erase"],
          ["organization_licences", "organization_id", "org-erase-own"],
          ["subscription", "id", "subscription-erase"],
          ["session", "id", "session-erase"],
          ["account", "id", "credential-erase"],
          ["passkey", "id", "passkey-erase"],
          ['"twoFactor"', "id", "twofactor-erase"],
          ['"user"', "id", "user-erase"],
        ]) {
          const { rows } = await client.query(
            `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
            [value],
          );
          assert.equal(rows.length, 0, `${table} still holds ${value}`);
        }
        return "workspace, organization, member, invitations, enrollment invites, verification, licence, subscription, session, credential, passkey, second factor and user are gone";
      },
    );

    await check("the erase leaves the colleague's organization and seat alone", async () => {
      const organizations = await query(
        `SELECT id FROM organization WHERE id = 'org-erase-shared'`,
      );
      assert.equal(organizations.length, 1);
      const seats = await query(
        `SELECT "userId" FROM member WHERE "organizationId" = 'org-erase-shared' ORDER BY "userId"`,
      );
      assert.deepEqual(
        seats.map((row) => row.userId),
        ["user-other"],
      );
      const other = await query(`SELECT id FROM "user" WHERE id = 'user-other'`);
      assert.equal(other.length, 1);
      // The report says which organization was kept, and why, rather than counting it.
      const retained = eraseReport.organizations.find(
        (organization) => organization.organizationId === "org-erase-shared",
      );
      assert.equal(retained?.outcome, "retained");
    });

    await check("the erase report names the relay stores it could not reach", async () => {
      const relay = eraseReport.stores.filter((store) =>
        ["documents", "shares", "attachments"].includes(store.store),
      );
      assert.equal(relay.length, 3);
      for (const store of relay) {
        assert.equal(store.status, "not-configured");
        assert.equal(store.removed, 0);
        assert.match(store.reason ?? "", /no relay store/u);
      }
      assert.equal(eraseReport.complete, false);
      return "documents, shares and attachments report not-configured with the command that finishes them";
    });

    await check("the entitlement read sees an active subscription", async () => {
      await query(
        `INSERT INTO subscription (
           id, plan, "referenceId", "stripeCustomerId", "stripeSubscriptionId",
           status, "periodEnd", "cancelAtPeriodEnd"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ["sub-1", "team", "org-1", "cus-1", "sub_stripe_1", "active", new Date(NOW + DAY), false],
      );
      const { parseTierTable, createEntitlementReader, postgresSubscriptions } = await import(
        pathToFileURL(join(root, "services/billing/src/index.ts")).href
      );
      const tiers = parseTierTable(
        JSON.stringify({
          price_team: {
            tier: "team",
            workspaces: 3,
            documentBytes: 268435456,
            attachmentBytes: 1073741824,
          },
        }),
      );
      if (tiers.isErr()) throw new Error(tiers.error.message);
      const reader = createEntitlementReader({
        subscriptions: postgresSubscriptions({
          query: (text, values) => client.query(text, values),
        }),
        tiers: tiers.value,
      });
      const active = await reader.forOrganization("org-1");
      assert.equal(active.tier, "team");
      assert.equal(active.limits.workspaces, 3);
      return "an active row projects its plan limits";
    });

    await check("a cancelled subscription falls back to free", async () => {
      await query(`UPDATE subscription SET status = 'canceled' WHERE id = $1`, ["sub-1"]);
      const { parseTierTable, createEntitlementReader, postgresSubscriptions } = await import(
        pathToFileURL(join(root, "services/billing/src/index.ts")).href
      );
      const tiers = parseTierTable(
        JSON.stringify({
          price_team: {
            tier: "team",
            workspaces: 3,
            documentBytes: 268435456,
            attachmentBytes: 1073741824,
          },
        }),
      );
      if (tiers.isErr()) throw new Error(tiers.error.message);
      const reader = createEntitlementReader({
        subscriptions: postgresSubscriptions({
          query: (text, values) => client.query(text, values),
        }),
        tiers: tiers.value,
      });
      const cancelled = await reader.forOrganization("org-1");
      assert.equal(cancelled.tier, "free");
      return "a cancelled plan reads as free, not team";
    });

    await check(
      "a subscription projects onto organization_licences, so one tier answers both",
      async () => {
        // The reported bug, on the real schema: the token said `team` while the seat check
        // counted the row 0009's trigger wrote, which said `free`. Both readers below are
        // the shipped ones — `postgresLicences` is what `checkSeatAllowance` counts against
        // and `createEntitlementReader` is what mints the claim — so a disagreement is the
        // bug rather than a difference between fakes.
        const {
          createEntitlementReader,
          createLicenceProjection,
          parseTierTable,
          postgresLicenceRows,
          postgresSubscriptions,
        } = await import(pathToFileURL(join(root, "services/billing/src/index.ts")).href);
        const tiers = parseTierTable(
          JSON.stringify({
            price_team: {
              tier: "team",
              workspaces: 3,
              documentBytes: 268435456,
              attachmentBytes: 1073741824,
            },
          }),
        );
        if (tiers.isErr()) throw new Error(tiers.error.message);

        const queryable = { query: (text, values) => client.query(text, values) };
        const subscriptions = postgresSubscriptions(queryable);
        // Both sides are given the same clock, explicitly: the fixture timestamps are fixed
        // (`NOW`), so a reader on the wall clock would answer a different question from the
        // projection and the comparison would say nothing.
        const reader = createEntitlementReader({
          subscriptions,
          tiers: tiers.value,
          now: () => NOW,
        });
        const projection = createLicenceProjection({
          rows: postgresLicenceRows(queryable),
          tiers: tiers.value,
          free: FREE_LICENCE_TIER,
          now: () => NOW,
        });

        const statuses = [
          ["active", NOW + DAY, "team"],
          ["trialing", NOW + DAY, "team"],
          ["past_due", NOW + DAY, "team"],
          // The grace window closed: Stripe is still retrying, the token has said `free`
          // since `periodEnd`, and the row has to say the same thing.
          ["past_due", NOW - DAY, "free"],
          ["canceled", NOW - DAY, "free"],
        ];

        const answers = [];
        for (const [status, periodEnd, expected] of statuses) {
          await query(`UPDATE subscription SET status = $1, "periodEnd" = $2 WHERE id = $3`, [
            status,
            new Date(periodEnd),
            "sub-1",
          ]);
          const row = await subscriptions.forOrganization("org-1");
          assert.ok(row !== null, "the subscription row the projection reads is gone");

          await projection.project({
            organizationId: "org-1",
            seats: 1,
            subscriptionId: "sub_stripe_1",
            ...row,
          });

          const token = await reader.forOrganization("org-1");
          const seat = await repositories.licences.forOrganization("org-1");
          assert.ok(seat !== null, "the projection wrote no licence row");
          assert.equal(
            seat.claims.tier,
            token.tier,
            `${status} mints ${token.tier} but the seat check reads ${seat.claims.tier}`,
          );
          assert.equal(seat.claims.tier, expected);
          if (expected === "free") {
            assert.equal(seat.claims.id, "free:org-1", "the fallback is not the free row");
            assert.equal(seat.seats, FREE_LICENCE_TIER.seats);
          } else {
            assert.equal(seat.claims.workspaces, 3);
            // The paid horizon is the period Stripe billed, so a stale row expires instead
            // of granting a plan forever.
            assert.equal(seat.claims.expiresAt, periodEnd);
          }
          answers.push(`${status}→${seat.claims.tier}`);
        }

        // An organization with no subscription keeps the free row rather than losing it.
        await projection.release("org-2");
        const nobody = await repositories.licences.forOrganization("org-2");
        assert.ok(nobody !== null);
        assert.equal(nobody.claims.tier, FREE_LICENCE_TIER.tier);
        assert.equal((await reader.forOrganization("org-2")).tier, FREE_LICENCE_TIER.tier);
        answers.push(`no subscription→${nobody.claims.tier}`);

        return answers.join(", ");
      },
    );

    // --- the relay purge, end to end ------------------------------------------
    //
    // The account erase owns Postgres. The relay owns the documents, the share rows
    // and the attachment bytes, and it removes them through one route. These two
    // checks drive that route through the port `apps/control-plane/src/modules/auth.ts`
    // builds, so the URL, the credential, the shape of the delete and the counts the
    // report carries are the shipped ones rather than a re-description of them.

    /**
     * The relay, in this process, over the files a deployment would use.
     *
     * `SUITE_RELAY_URL` and `SUITE_RELAY_PURGE_TOKEN` are set rather than passed in,
     * because those two variables are the whole wiring: the route reads the token and
     * the control-plane port reads both.
     */
    const relayFixture = async () => {
      const relayDir = join(dir, "relay");
      mkdirSync(relayDir, { recursive: true });
      const paths = {
        documents: join(relayDir, "documents.sqlite"),
        shares: join(relayDir, "shares.sqlite"),
        workspaces: join(relayDir, "workspaces.sqlite"),
      };
      const attachmentsPath = join(relayDir, "attachments.sqlite");
      const importFrom = (relative) => import(pathToFileURL(join(root, relative)).href);

      // The relay's route is TypeScript this script cannot load by stripping types
      // alone (`HttpError` is a class with a parameter property), and the point of
      // these checks is to call the shipped handler rather than a re-description of
      // it. `tsx` is the compiler the control plane already runs on.
      const tsx = createRequire(join(root, "apps/control-plane/package.json"));
      const { register: registerTsx } = await import(
        pathToFileURL(tsx.resolve("tsx/esm/api")).href
      );
      registerTsx();

      const [{ createDocumentStore }, { createShareStore }, { createSqliteAttachmentStore }] =
        await Promise.all([
          importFrom("apps/collab-server/src/store/persistence.ts"),
          importFrom("apps/collab-server/src/store/shares.ts"),
          importFrom("apps/collab-server/src/store/attachments.ts"),
        ]);
      const { createWorkspaceOrgStore } = await importFrom(
        "apps/collab-server/src/store/workspaceOrgs.ts",
      );
      const [{ handleWorkspaceRequest }, { createWorkspaceAccess }, { noSessionVerifier }] =
        await Promise.all([
          importFrom("apps/collab-server/src/http/workspaceHttp.ts"),
          importFrom("apps/collab-server/src/http/access.ts"),
          importFrom("apps/collab-server/src/http/sessionToken.ts"),
        ]);
      const { relayWorkspaceData } = await importFrom("apps/control-plane/src/modules/auth.ts");
      const { createServer: createHttpServer } = await import("node:http");
      const { DatabaseSync } = await import("node:sqlite");

      const documents = createDocumentStore(paths.documents);
      const fileShares = createShareStore(paths.shares);
      const orgs = createWorkspaceOrgStore(paths.workspaces);
      const attachments = createSqliteAttachmentStore(attachmentsPath);
      // A relay with no control plane verifies no session. That is the deployment this
      // route's service half exists for: the only caller left is the purge.
      const access = createWorkspaceAccess({ sessions: noSessionVerifier, orgs });

      // The credential a deployment puts in `SUITE_RELAY_PURGE_TOKEN`. The route and
      // the port below are given the same value, which is the pair this check is about.
      const purgeToken = "db-verify-purge-token";
      const server = createHttpServer((request, response) => {
        void handleWorkspaceRequest(request, response, {
          access,
          storage: paths,
          attachments,
          purgeToken,
          exists: (workspaceId) =>
            documents.load(`%LOR:${workspaceId}`) !== null ||
            fileShares.list(workspaceId).length > 0,
          forgetWorkspace: (workspaceId) => {
            orgs.remove(workspaceId);
          },
        }).then((handled) => {
          if (handled) return;
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("expected a TCP address");

      // The two variables, named the way a deployment names them.
      const port = relayWorkspaceData({
        SUITE_RELAY_URL: `http://127.0.0.1:${address.port}`,
        SUITE_RELAY_PURGE_TOKEN: purgeToken,
      });
      assert.ok(port !== null, "the port was not built from the two variables");

      const rows = (path, table) => {
        const db = new DatabaseSync(path);
        try {
          return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
        } finally {
          db.close();
        }
      };

      return {
        address,
        port,
        paths,
        attachmentsPath,
        documents,
        fileShares,
        orgs,
        attachments,
        rows,
        close: async () => {
          await new Promise((resolve) => server.close(resolve));
          documents.close();
          fileShares.close();
          orgs.close();
          attachments.close();
        },
      };
    };

    const relay = await relayFixture();
    try {
      await check(
        "the control plane purges a workspace's document, share rows and attachment bytes",
        async () => {
          const workspaceId = "ws-purge";
          relay.documents.save(`%LOR:${workspaceId}`, new TextEncoder().encode("workspace one"));
          const created = relay.fileShares.create({
            workspaceId,
            scope: "board",
            role: "viewer",
            boardId: "board-1",
          });
          relay.fileShares.setBaseline(created.share.id, new Uint8Array([1, 2, 3]));
          relay.documents.save(
            `%LOR:share-${created.token}`,
            new TextEncoder().encode("projected board"),
          );
          relay.documents.flush();
          relay.attachments.put(workspaceId, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
          relay.orgs.claim(workspaceId, "org-erase-own");

          // A wrong credential is refused, and nothing was removed: the service half
          // is a credential, not a fallback for a request that presents no session.
          const denied = await fetch(
            `http://127.0.0.1:${relay.address.port}/api/workspaces/${workspaceId}`,
            {
              method: "DELETE",
              headers: {
                authorization: "Bearer wrong-token",
                "content-type": "application/json",
              },
              body: JSON.stringify({ confirm: workspaceId }),
            },
          );
          assert.equal(denied.status, 401, "a wrong purge token was not refused");
          assert.equal(relay.rows(relay.paths.documents, "documents"), 2);

          const counts = await relay.port.erase(workspaceId);
          // The workspace document and its projected share room; the share row and its
          // draft baseline; the attachment row that carries the bytes.
          assert.deepEqual(counts, { documents: 2, shares: 2, attachments: 1 });

          assert.equal(relay.rows(relay.paths.documents, "documents"), 0, "a row survived");
          assert.equal(relay.rows(relay.paths.shares, "shares"), 0, "a share row survived");
          assert.equal(relay.rows(relay.paths.shares, "share_baselines"), 0, "a baseline survived");
          assert.equal(
            relay.rows(relay.paths.workspaces, "workspace_orgs"),
            0,
            "an org row survived",
          );
          assert.equal(relay.rows(relay.attachmentsPath, "attachments"), 0, "an image survived");
          assert.equal(relay.attachments.usage(workspaceId), 0, "attachment bytes survived");

          // The retry an interrupted erase depends on: zero rows, not 404.
          assert.deepEqual(await relay.port.erase(workspaceId), {
            documents: 0,
            shares: 0,
            attachments: 0,
          });

          // The export's share read is not part of this credential, and the port says
          // so rather than answering an empty list that would read as "no links".
          await assert.rejects(relay.port.shares(workspaceId), /no service read/u);

          return "2 document rows, 2 share rows and 1 attachment row with its bytes removed; the retry removed nothing";
        },
      );

      await check(
        "an account erase reports the relay stores as removed, with the counts it removed",
        async () => {
          // A second account, alone in its own organization, so the erase owns the
          // workspace and the relay has something to take.
          await query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [
            "user-purge",
            "Puri",
            "purge@example.com",
          ]);
          await query(`INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)`, [
            "org-purge",
            "Purge Studio",
            "purge-studio",
          ]);
          await query(
            `INSERT INTO member (id, "organizationId", "userId", role) VALUES ($1, $2, $3, $4)`,
            ["member-purge", "org-purge", "user-purge", "owner"],
          );
          await query(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [
            "ws-purge-2",
            "org-purge",
            "Purge Q4",
          ]);

          relay.documents.save("%LOR:ws-purge-2", new TextEncoder().encode("second workspace"));
          relay.fileShares.create({
            workspaceId: "ws-purge-2",
            scope: "workspace",
            role: "viewer",
          });
          relay.documents.flush();
          relay.attachments.put("ws-purge-2", new Uint8Array([1, 1, 1, 1]), "image/png");
          relay.orgs.claim("ws-purge-2", "org-purge");

          const report = await eraseAccount(
            { userId: "user-purge" },
            { accounts, workspaceData: relay.port, now: () => NOW },
          );
          assert.equal(report.deleted, true, "the account row survived");
          assert.equal(report.complete, true, "a store reported leftovers");
          const entry = (name) => report.stores.find((store) => store.store === name);
          // The three that used to be not-configured are now counts, and the report
          // keeps its shape: same stores, same status vocabulary.
          assert.deepEqual(entry("documents"), {
            store: "documents",
            status: "removed",
            removed: 1,
          });
          assert.deepEqual(entry("shares"), { store: "shares", status: "removed", removed: 1 });
          assert.deepEqual(entry("attachments"), {
            store: "attachments",
            status: "removed",
            removed: 1,
          });
          assert.equal(
            report.stores.filter((store) => store.status !== "removed").length,
            0,
            "a store reported leftovers",
          );
          assert.equal(
            report.workspaces.find((workspace) => workspace.workspaceId === "ws-purge-2")?.outcome,
            "removed",
          );
          assert.equal(relay.attachments.usage("ws-purge-2"), 0, "attachment bytes survived");
          assert.equal(relay.rows(relay.paths.documents, "documents"), 0, "a document survived");
          assert.equal(relay.rows(relay.attachmentsPath, "attachments"), 0, "an image survived");
          const remaining = await query(`SELECT id FROM workspaces WHERE id = 'ws-purge-2'`);
          assert.equal(remaining.length, 0, "the control-plane workspace row survived");
          return "documents, shares and attachments report removed 1/1/1; the account and its workspace are gone";
        },
      );
    } finally {
      await relay.close();
    }

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
