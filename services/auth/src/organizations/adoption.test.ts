import { describe, expect, it } from "vitest";
import type { OrganizationRole } from "../types.js";
import { type AdoptionStore, adoptAnonymousOrganizations } from "./adoption.js";

/**
 * Adopting an anonymous account's organizations
 * (ADR-0067 §8).
 *
 * Three properties are load-bearing: the work survives the anonymous user's
 * deletion, the ids never move, and nothing is adopted that the anonymous account
 * did not own.
 */

interface Row {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

function fakeStore(rows: Row[]): AdoptionStore & { rows: Row[] } {
  const state = { rows: [...rows] };
  return {
    rows: state.rows,
    organizationsForUser: async (userId) =>
      state.rows.filter((row) => row.userId === userId).map((row) => row.organizationId),
    roleFor: async (organizationId, userId) =>
      state.rows.find((row) => row.organizationId === organizationId && row.userId === userId)
        ?.role ?? null,
    addMember: async ({ organizationId, userId, role }) => {
      state.rows.push({ organizationId, userId, role });
    },
    removeMember: async ({ organizationId, userId }) => {
      const index = state.rows.findIndex(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );
      if (index >= 0) state.rows.splice(index, 1);
    },
  };
}

const NOW = 1_760_000_000_000;

describe("adopting an anonymous account's organizations", () => {
  it("gives the new account ownership, so the workspaces outlive the anonymous user", async () => {
    const store = fakeStore([{ organizationId: "org-personal", userId: "anon", role: "owner" }]);

    const outcome = await adoptAnonymousOrganizations(store, {
      fromUserId: "anon",
      toUserId: "real",
      now: NOW,
    });

    expect(outcome.adopted).toEqual(["org-personal"]);
    // Ownership moves as a membership: no workspace row was touched, so every
    // document id, URL and share link still resolves.
    expect(store.rows).toEqual([{ organizationId: "org-personal", userId: "real", role: "owner" }]);
  });

  it("does not adopt an organization the anonymous account merely belonged to", async () => {
    const store = fakeStore([
      { organizationId: "org-personal", userId: "anon", role: "owner" },
      { organizationId: "org-someone-else", userId: "anon", role: "member" },
    ]);

    const outcome = await adoptAnonymousOrganizations(store, {
      fromUserId: "anon",
      toUserId: "real",
      now: NOW,
    });

    // A member cannot hand over a tenant they do not own; sweeping it up would be
    // privilege escalation wearing a convenience's clothes.
    expect(outcome.adopted).toEqual(["org-personal"]);
    expect(
      store.rows.some((row) => row.organizationId === "org-someone-else" && row.userId === "real"),
    ).toBe(false);
  });

  it("is idempotent when the link runs twice", async () => {
    const store = fakeStore([{ organizationId: "org-personal", userId: "anon", role: "owner" }]);

    await adoptAnonymousOrganizations(store, { fromUserId: "anon", toUserId: "real", now: NOW });
    const second = await adoptAnonymousOrganizations(store, {
      fromUserId: "anon",
      toUserId: "real",
      now: NOW,
    });

    expect(second.adopted).toEqual([]);
    expect(store.rows).toHaveLength(1);
  });

  it("leaves the seat count honest by dropping the anonymous membership", async () => {
    const store = fakeStore([
      { organizationId: "org-personal", userId: "anon", role: "owner" },
      { organizationId: "org-personal", userId: "colleague", role: "member" },
    ]);

    await adoptAnonymousOrganizations(store, { fromUserId: "anon", toUserId: "real", now: NOW });

    // Two members, not three: the anonymous row is gone before Better Auth's own
    // delete would reach it, so a seat check in between cannot double-count.
    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((row) => row.userId).sort()).toEqual(["colleague", "real"]);
  });

  it("does nothing when the ids are the same, which the plugin can produce", async () => {
    const store = fakeStore([{ organizationId: "org-personal", userId: "anon", role: "owner" }]);

    const outcome = await adoptAnonymousOrganizations(store, {
      fromUserId: "anon",
      toUserId: "anon",
      now: NOW,
    });

    expect(outcome.adopted).toEqual([]);
    expect(store.rows).toHaveLength(1);
  });
});
