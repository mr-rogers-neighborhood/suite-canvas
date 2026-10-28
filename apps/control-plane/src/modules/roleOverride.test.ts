import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createRoleOverrideStore, isWearableRole, overrideBody } from "./roleOverride.js";

/**
 * The worn-role row over a stub pool.
 *
 * What is pinned is that the row is the only thing written — no membership, no seat — and
 * that `lookup` answers the questions the auth wrapper asks: nothing for a stranger,
 * nothing in another organization, the worn role in the one it was set in.
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
    } as unknown as Pick<Pool, "query">,
  };
}

const row = {
  user_id: "user-operator",
  organization_id: "org-1",
  role: "member",
  set_at: "1700000000000",
};

describe("isWearableRole", () => {
  it("accepts the three roles and refuses anything else", () => {
    expect(isWearableRole("owner")).toBe(true);
    expect(isWearableRole("admin")).toBe(true);
    expect(isWearableRole("member")).toBe(true);
    expect(isWearableRole("superuser")).toBe(false);
    expect(isWearableRole(null)).toBe(false);
    expect(isWearableRole(7)).toBe(false);
  });
});

describe("setting a costume", () => {
  it("creates the table once and upserts one row per operator", async () => {
    const { calls, pool } = stub();
    const store = createRoleOverrideStore(pool);

    await store.set({ userId: "user-operator", organizationId: "org-1", role: "member" }, 10);
    await store.set({ userId: "user-operator", organizationId: "org-1", role: "owner" }, 20);

    expect(calls.filter((call) => call.text.includes("CREATE TABLE"))).toHaveLength(1);
    const upserts = calls.filter((call) =>
      call.text.includes("INSERT INTO operator_role_overrides"),
    );
    expect(upserts).toHaveLength(2);
    expect(upserts[1]?.values).toEqual(["user-operator", "org-1", "owner", 20]);
    // Not a membership: nothing in this store writes `member`.
    expect(
      calls.some((call) => /\b(member|INSERT INTO member|UPDATE member)\b/u.test(call.text)),
    ).toBe(false);
  });

  it("returns what it wrote, so the caller can answer without a second read", async () => {
    const { pool } = stub();
    const store = createRoleOverrideStore(pool);

    expect(await store.set({ userId: "u", organizationId: "o", role: "admin" }, 5)).toEqual({
      userId: "u",
      organizationId: "o",
      role: "admin",
      setAt: 5,
    });
  });

  it("refuses to read a row whose role is not one of the three", async () => {
    const { pool } = stub([{ ...row, role: "root" }]);

    expect(await createRoleOverrideStore(pool).get("user-operator")).toBeNull();
  });
});

describe("the lookup the auth wrapper asks", () => {
  it("answers the worn role in the organization it was set in", async () => {
    const { pool } = stub([row]);
    const store = createRoleOverrideStore(pool);

    expect(
      await store.lookup({ userId: "user-operator", organizationId: "org-1", role: "owner" }),
    ).toBe("member");
  });

  it("answers nothing in another organization, because a costume is not a membership", async () => {
    const { pool } = stub([row]);
    const store = createRoleOverrideStore(pool);

    expect(
      await store.lookup({ userId: "user-operator", organizationId: "org-2", role: "owner" }),
    ).toBeNull();
  });

  it("answers nothing for a non-member, without reading the table", async () => {
    const { calls, pool } = stub([row]);
    const store = createRoleOverrideStore(pool);

    expect(
      await store.lookup({ userId: "user-operator", organizationId: "org-1", role: null }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("answers nothing when no costume is set", async () => {
    const { pool } = stub([]);

    expect(
      await createRoleOverrideStore(pool).lookup({
        userId: "user-operator",
        organizationId: "org-1",
        role: "owner",
      }),
    ).toBeNull();
  });
});

describe("clearing it", () => {
  it("deletes the row", async () => {
    const { calls, pool } = stub();

    await createRoleOverrideStore(pool).clear("user-operator");

    expect(calls.some((call) => call.text.includes("DELETE FROM operator_role_overrides"))).toBe(
      true,
    );
    expect(calls.at(-1)?.values).toEqual(["user-operator"]);
  });
});

describe("overrideBody", () => {
  it("says nothing is worn without inventing a role", () => {
    expect(overrideBody(null)).toEqual({ role: null, organizationId: null, setAt: null });
    expect(
      overrideBody({
        userId: "user-operator",
        organizationId: "org-1",
        role: "member",
        setAt: 1_700_000_000_000,
      }),
    ).toEqual({
      role: "member",
      organizationId: "org-1",
      setAt: 1_700_000_000_000,
    });
  });
});
