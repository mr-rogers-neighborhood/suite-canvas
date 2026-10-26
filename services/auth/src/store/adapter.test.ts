import { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { databaseUrlProblem, kyselyDatabase, poolQueryable, postgresDatabase } from "./postgres.js";

/**
 * The adapter seam (ADR-0065 §9, ADR-0070).
 *
 * The service once handed Better Auth a raw `pg` pool through
 * `as unknown as AuthDatabase`, which is why nothing proved the adapter was the
 * shape the installed version documents. What is asserted here is the shape itself:
 * a query *executor* the adapter built, and a raw-SQL seam beside it over the same
 * pool. No connection is opened, so this stays out of `pnpm test`'s dependency list.
 */
const CONNECTION = "postgres://suite@db.example:5432/suite";

/** The `db` member of the adapter, as the Kysely instance it must be. */
function executorOf(database: unknown): unknown {
  if (typeof database !== "object" || database === null) {
    throw new Error("the adapter is not an object");
  }
  return (database as { db?: unknown }).db;
}

describe("the Postgres adapter", () => {
  it("is a Kysely query executor, not an arbitrary object", () => {
    const opened = postgresDatabase({ connectionString: CONNECTION });

    expect(opened.database).toMatchObject({ type: "postgres" });
    const executor = executorOf(opened.database);
    expect(executor).toBeInstanceOf(Kysely);
    // The two methods every query the adapter builds goes through. An object that
    // merely has `query` — the old cast — has neither.
    expect(typeof (executor as Kysely<unknown>).selectFrom).toBe("function");
    expect(typeof (executor as Kysely<unknown>).executeQuery).toBe("function");
    expect((executor as { query?: unknown }).query).toBeUndefined();
  });

  it("keeps the raw-SQL seam on the same pool, with a connection for transactions", async () => {
    const opened = postgresDatabase({ connectionString: CONNECTION });

    expect(typeof opened.queryable.query).toBe("function");
    // The migration runner opens one transaction per file, and `BEGIN`/`COMMIT` on a
    // pool can land on different connections. `connect` is what prevents that; the
    // call below is never made, so no socket is opened.
    expect(typeof opened.queryable.connect).toBe("function");
    expect(typeof opened.kysely.selectFrom).toBe("function");

    await opened.close();
  });

  it("refuses a connection string it cannot use, before building anything", () => {
    expect(() => postgresDatabase({ connectionString: "mysql://u@h/db" })).toThrowError(
      /must be a postgres/,
    );
    expect(databaseUrlProblem(undefined)).toBe("is not set");
  });

  it("wraps a pool as a Queryable with a real body, so `query` narrows both overloads", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: readonly unknown[]) => {
        calls.push(values === undefined ? { text } : { text, values });
        return { rows: [{ ok: true }] };
      },
    } as unknown as Parameters<typeof poolQueryable>[0];

    const queryable = poolQueryable(pool);
    expect(await queryable.query("SELECT 1")).toEqual({ rows: [{ ok: true }] });
    expect(await queryable.query("SELECT $1", ["a"])).toEqual({ rows: [{ ok: true }] });
    expect(calls).toEqual([{ text: "SELECT 1" }, { text: "SELECT $1", values: ["a"] }]);
  });

  it("builds the adapter over a Kysely handle as well as over a pool", () => {
    const db = new Kysely<unknown>({
      dialect: {
        // A dialect that never opens anything: the adapter only stores the handle.
        createAdapter: () => ({}) as never,
        createDriver: () => ({}) as never,
        createIntrospector: () => ({}) as never,
        createQueryCompiler: () => ({}) as never,
      },
    });
    expect(kyselyDatabase(db)).toMatchObject({ type: "postgres", db });
  });
});
