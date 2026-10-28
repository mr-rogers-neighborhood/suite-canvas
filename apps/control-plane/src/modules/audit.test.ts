import { describe, expect, it } from "vitest";
import { clampLimit, createAuditStore } from "./audit.js";

/**
 * The audit table, over a stub pool.
 *
 * What is pinned is the statements and the paging: a row per call, the table and its index
 * created once, and a page that cannot repeat or skip a row when two acts share a
 * millisecond. The SQL itself is the migration's business.
 */
function stub(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] | undefined }[] = [];
  return {
    calls,
    pool: {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows };
      },
    },
  };
}

const row = {
  id: "7",
  at: "1700000000000",
  actor: "user-operator",
  action: "impersonate",
  target: "user-target",
  outcome: "ok",
  details: { grant: "2026-10-01" },
};

describe("recording an act", () => {
  it("creates the table and its index once, then inserts", async () => {
    const { calls, pool } = stub();
    const audit = createAuditStore(pool as unknown as Parameters<typeof createAuditStore>[0]);

    await audit.record({ actor: "a", action: "impersonate", target: "t", outcome: "ok" }, 1);
    await audit.record({ actor: "a", action: "stop", target: "t", outcome: "ok" }, 2);

    expect(calls.filter((call) => call.text.includes("CREATE TABLE"))).toHaveLength(1);
    expect(calls.filter((call) => call.text.includes("CREATE INDEX"))).toHaveLength(1);
    const inserts = calls.filter((call) => call.text.includes("INSERT INTO operator_audit"));
    expect(inserts).toHaveLength(2);
    // The details go in as JSON text so `jsonb` holds data rather than a quoted string.
    expect(inserts[0]?.values).toEqual([1, "a", "impersonate", "t", "ok", "{}"]);
  });

  it("keeps the details a caller passes", async () => {
    const { calls, pool } = stub();
    const audit = createAuditStore(pool as unknown as Parameters<typeof createAuditStore>[0]);

    await audit.record(
      {
        actor: "a",
        action: "settings.write",
        target: "billing.mode",
        outcome: "ok",
        details: { from: "test", to: "live" },
      },
      5,
    );

    expect(calls.at(-1)?.values?.[5]).toBe('{"from":"test","to":"live"}');
  });

  it("retries the table creation after a failure, rather than staying broken", async () => {
    let attempts = 0;
    const audit = createAuditStore({
      query: async (text: unknown) => {
        if (typeof text === "string" && text.includes("CREATE TABLE")) {
          attempts += 1;
          if (attempts === 1) throw new Error("postgres is not up yet");
        }
        return { rows: [] };
      },
    } as unknown as Parameters<typeof createAuditStore>[0]);

    await expect(
      audit.record({ actor: "a", action: "x", target: "t", outcome: "ok" }),
    ).rejects.toThrow("postgres is not up yet");
    await audit.record({ actor: "a", action: "x", target: "t", outcome: "ok" });

    expect(attempts).toBe(2);
  });
});

describe("reading the trail", () => {
  it("returns rows newest first with their details", async () => {
    const { calls, pool } = stub([row]);
    const audit = createAuditStore(pool as unknown as Parameters<typeof createAuditStore>[0]);

    const records = await audit.recent();

    expect(records).toEqual([
      {
        id: 7,
        at: 1_700_000_000_000,
        actor: "user-operator",
        action: "impersonate",
        target: "user-target",
        outcome: "ok",
        details: { grant: "2026-10-01" },
      },
    ]);
    expect(calls.at(-1)?.text).toContain("ORDER BY at DESC, id DESC");
  });

  it("pages on the (at, id) tuple so a shared millisecond cannot repeat or skip", async () => {
    const { calls, pool } = stub();
    const audit = createAuditStore(pool as unknown as Parameters<typeof createAuditStore>[0]);

    await audit.recent({ before: { at: 1_700_000_000_000, id: 42 } });

    expect(calls.at(-1)?.text).toContain("(at, id) < ($1, $2)");
    expect(calls.at(-1)?.values).toEqual([1_700_000_000_000, 42, 50]);
  });

  it("filters by actor and by action", async () => {
    const { calls, pool } = stub();
    const audit = createAuditStore(pool as unknown as Parameters<typeof createAuditStore>[0]);

    await audit.recent({ actor: "user-operator", action: "impersonate" });

    expect(calls.at(-1)?.text).toContain("actor = $1 AND action = $2");
    expect(calls.at(-1)?.values).toEqual(["user-operator", "impersonate", 50]);
  });

  it("caps the page so a caller cannot ask for the whole table", async () => {
    const { calls, pool } = stub();
    const audit = createAuditStore(pool as unknown as Parameters<typeof createAuditStore>[0]);

    await audit.recent({ limit: 10_000 });

    expect(calls.at(-1)?.values?.at(-1)).toBe(200);
  });
});

describe("clampLimit", () => {
  it("reads a missing or unusable limit as the default", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(Number.NaN)).toBe(50);
  });
});
