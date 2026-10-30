import { describe, expect, it } from "vitest";
import {
  checksumOf,
  MigrationChecksumError,
  type MigrationConnection,
  type MigrationFile,
  type MigrationTarget,
  migrate,
  migrationFiles,
  migrationsEnabled,
  planMigrations,
  status,
} from "./migrate.js";

/**
 * The migration runner.
 *
 * No database: a recording fake answers the runner's own statements and holds the
 * `schema_migrations` rows, which is enough to pin the three promises that matter —
 * every file applies once, in order, inside a transaction, and a file that changed
 * after it was applied refuses the boot.
 */

interface Statement {
  text: string;
  values: readonly unknown[] | undefined;
}

const RUNNER_PREFIXES = [
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "CREATE TABLE",
  "SELECT filename",
  "INSERT INTO schema_migrations",
];

function isMigrationBody(text: string): boolean {
  return !RUNNER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

interface FakeTarget extends MigrationTarget {
  statements: Statement[];
  committed: Map<string, string>;
  readonly connects: number;
  readonly releases: number;
}

/**
 * A fake pool. Inserts are buffered until `COMMIT`, so a rolled-back migration
 * leaves no row — which is the property under test.
 */
function fake(
  options: {
    /** Fails the nth migration body, 1-based. */
    failOnMigration?: number;
    /** Pre-seeds applied rows, as if a previous run had written them. */
    applied?: readonly { filename: string; checksum: string }[];
    /** False for an adapter that is a single connection, like the memory store. */
    pooled?: boolean;
  } = {},
): FakeTarget {
  const statements: Statement[] = [];
  const committed = new Map<string, string>(
    (options.applied ?? []).map((row) => [row.filename, row.checksum]),
  );
  let buffered: [string, string][] | null = null;
  let bodies = 0;
  let connects = 0;
  let releases = 0;

  const query: MigrationTarget["query"] = async (text, values) => {
    statements.push({ text, values });
    if (text === "BEGIN") {
      buffered = [];
      return { rows: [] };
    }
    if (text === "COMMIT") {
      for (const [filename, checksum] of buffered ?? []) committed.set(filename, checksum);
      buffered = null;
      return { rows: [] };
    }
    if (text === "ROLLBACK") {
      buffered = null;
      return { rows: [] };
    }
    if (text.startsWith("SELECT filename")) {
      return {
        rows: [...committed.entries()]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([filename, checksum]) => ({ filename, checksum })),
      };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      if (buffered === null) throw new Error("the runner inserted outside a transaction");
      buffered.push([String(values?.[0]), String(values?.[1])]);
      return { rows: [] };
    }
    if (!isMigrationBody(text)) return { rows: [] };

    bodies += 1;
    if (options.failOnMigration === bodies) throw new Error(`syntax error in migration ${bodies}`);
    return { rows: [] };
  };

  const target: FakeTarget = {
    statements,
    committed,
    get connects() {
      return connects;
    },
    get releases() {
      return releases;
    },
    query,
    ...(options.pooled === false
      ? {}
      : {
          connect: async (): Promise<MigrationConnection> => {
            connects += 1;
            return {
              query,
              release: () => {
                releases += 1;
              },
            };
          },
        }),
  };
  return target;
}

const silent = () => {};

/** The number of migration files on disk, so adding one does not edit this file. */
const MIGRATION_COUNT = migrationFiles().length;

describe("migration discovery", () => {
  it("reads sql/*.sql in lexical order and checksums every file", () => {
    const files = migrationFiles();

    expect(files.map((file) => file.name)).toEqual([
      "0001_control_plane.sql",
      "0002_plugins.sql",
      "0003_billing.sql",
      "0004_licence_limits.sql",
      "0005_enrollment.sql",
      "0006_jwks.sql",
      "0007_subscription.sql",
      "0008_drop_billing_tables.sql",
      "0009_free_licence_provisioning.sql",
      "0010_templates.sql",
      "0011_no_free_workspace.sql",
      "0012_subscription_billing_mode.sql",
      "0013_unlimited_free_workspaces.sql",
    ]);
    for (const file of files) {
      expect(file.sql.length).toBeGreaterThan(0);
      expect(file.checksum).toBe(checksumOf(file.sql));
      expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("planMigrations", () => {
  const files: MigrationFile[] = [
    { name: "0001_a.sql", sql: "a", checksum: "hash-a" },
    { name: "0002_b.sql", sql: "b", checksum: "hash-b" },
  ];

  it("reports every file as pending against an empty schema_migrations", () => {
    expect(planMigrations(files, [])).toEqual({
      applied: [],
      pending: ["0001_a.sql", "0002_b.sql"],
      drifted: [],
    });
  });

  it("separates applied, pending and drifted files", () => {
    const unchanged = planMigrations(files, [{ filename: "0001_a.sql", checksum: "hash-a" }]);
    expect(unchanged.applied).toEqual(["0001_a.sql"]);
    expect(unchanged.pending).toEqual(["0002_b.sql"]);

    const changed = planMigrations(files, [{ filename: "0001_a.sql", checksum: "other" }]);
    expect(changed.drifted).toEqual(["0001_a.sql"]);
    expect(changed.applied).toEqual([]);
  });
});

describe("migrate", () => {
  it("applies every file once, in order, one transaction each, one log line each", async () => {
    const target = fake();
    const lines: string[] = [];

    const report = await migrate(target, { log: (line) => lines.push(line) });

    expect(report.applied).toEqual([
      "0001_control_plane.sql",
      "0002_plugins.sql",
      "0003_billing.sql",
      "0004_licence_limits.sql",
      "0005_enrollment.sql",
      "0006_jwks.sql",
      "0007_subscription.sql",
      "0008_drop_billing_tables.sql",
      "0009_free_licence_provisioning.sql",
      "0010_templates.sql",
      "0011_no_free_workspace.sql",
      "0012_subscription_billing_mode.sql",
      "0013_unlimited_free_workspaces.sql",
    ]);
    expect(report.skipped).toEqual([]);
    expect(target.committed.size).toBe(13);
    expect(target.connects).toBe(13);
    expect(target.releases).toBe(13);
    expect(lines).toEqual([
      "auth migration applied: 0001_control_plane.sql",
      "auth migration applied: 0002_plugins.sql",
      "auth migration applied: 0003_billing.sql",
      "auth migration applied: 0004_licence_limits.sql",
      "auth migration applied: 0005_enrollment.sql",
      "auth migration applied: 0006_jwks.sql",
      "auth migration applied: 0007_subscription.sql",
      "auth migration applied: 0008_drop_billing_tables.sql",
      "auth migration applied: 0009_free_licence_provisioning.sql",
      "auth migration applied: 0010_templates.sql",
      "auth migration applied: 0011_no_free_workspace.sql",
      "auth migration applied: 0012_subscription_billing_mode.sql",
      "auth migration applied: 0013_unlimited_free_workspaces.sql",
    ]);

    // Each body sits between its own BEGIN and COMMIT.
    const opens = target.statements.filter((statement) => statement.text === "BEGIN");
    const commits = target.statements.filter((statement) => statement.text === "COMMIT");
    expect(opens).toHaveLength(MIGRATION_COUNT);
    expect(commits).toHaveLength(MIGRATION_COUNT);
  });

  it("is idempotent: a second run applies nothing", async () => {
    const target = fake();
    await migrate(target, { log: silent });

    const lines: string[] = [];
    const second = await migrate(target, { log: (line) => lines.push(line) });

    expect(second.applied).toEqual([]);
    expect(second.skipped).toHaveLength(MIGRATION_COUNT);
    expect(lines).toEqual(["auth migrations: schema is up to date"]);
    expect(target.committed.size).toBe(MIGRATION_COUNT);
    expect(target.connects).toBe(MIGRATION_COUNT);
  });

  it("fails loudly, naming the file, when an applied file's checksum changed", async () => {
    const target = fake({
      applied: [{ filename: "0003_billing.sql", checksum: "0".repeat(64) }],
    });

    await expect(migrate(target, { log: silent })).rejects.toBeInstanceOf(MigrationChecksumError);
    await expect(migrate(target, { log: silent })).rejects.toThrowError(/0003_billing\.sql/);

    // Nothing was applied before the refusal: a drifted file cannot half-migrate.
    expect(target.statements.filter((statement) => statement.text === "BEGIN")).toHaveLength(0);
    expect(target.committed.size).toBe(1);
  });

  it("rolls back a failing migration and records nothing for it", async () => {
    const target = fake({ failOnMigration: 2 });

    await expect(migrate(target, { log: silent })).rejects.toThrowError(/migration 2/);

    expect(target.statements.some((statement) => statement.text === "ROLLBACK")).toBe(true);
    expect([...target.committed.keys()]).toEqual(["0001_control_plane.sql"]);
    expect(target.releases).toBe(2);
  });

  it("runs on the target itself when it cannot hand out a connection", async () => {
    const target = fake({ pooled: false });

    const report = await migrate(target, { log: silent });

    expect(report.applied).toHaveLength(MIGRATION_COUNT);
    expect(target.connects).toBe(0);
    expect(target.statements.filter((statement) => statement.text === "BEGIN")).toHaveLength(
      MIGRATION_COUNT,
    );
  });
});

describe("status", () => {
  it("reports pending filenames before the first run and none afterwards", async () => {
    const target = fake();

    const before = await status(target);
    expect(before.pending).toHaveLength(MIGRATION_COUNT);
    expect(before.applied).toEqual([]);

    await migrate(target, { log: silent });
    const after = await status(target);
    expect(after.pending).toEqual([]);
    expect(after.applied).toHaveLength(MIGRATION_COUNT);
  });

  it("reports a drifted file instead of throwing, so a health check can surface it", async () => {
    const target = fake({
      applied: [{ filename: "0002_plugins.sql", checksum: "1".repeat(64) }],
    });

    const report = await status(target);
    expect(report.drifted).toEqual(["0002_plugins.sql"]);
    expect(report.pending).toEqual([
      "0001_control_plane.sql",
      "0003_billing.sql",
      "0004_licence_limits.sql",
      "0005_enrollment.sql",
      "0006_jwks.sql",
      "0007_subscription.sql",
      "0008_drop_billing_tables.sql",
      "0009_free_licence_provisioning.sql",
      "0010_templates.sql",
      "0011_no_free_workspace.sql",
      "0012_subscription_billing_mode.sql",
      "0013_unlimited_free_workspaces.sql",
    ]);
  });

  it("treats a missing schema_migrations table as a database with nothing applied", async () => {
    const target: MigrationTarget = {
      query: async () => {
        throw Object.assign(new Error('relation "schema_migrations" does not exist'), {
          code: "42P01",
        });
      },
    };

    const report = await status(target);
    expect(report.pending).toHaveLength(MIGRATION_COUNT);
    expect(report.applied).toEqual([]);
  });
});

describe("the boot switch", () => {
  it("is on by default, including when the variable is blank", () => {
    expect(migrationsEnabled({})).toBe(true);
    expect(migrationsEnabled({ SUITE_AUTH_MIGRATE: "" })).toBe(true);
    expect(migrationsEnabled({ SUITE_AUTH_MIGRATE: "  " })).toBe(true);
    expect(migrationsEnabled({ SUITE_AUTH_MIGRATE: "1" })).toBe(true);
    expect(migrationsEnabled({ SUITE_AUTH_MIGRATE: "true" })).toBe(true);
  });

  it("is off only for the spellings an operator types on purpose", () => {
    for (const value of ["0", "false", "FALSE", "no", "off", " off "]) {
      expect(migrationsEnabled({ SUITE_AUTH_MIGRATE: value })).toBe(false);
    }
  });
});
