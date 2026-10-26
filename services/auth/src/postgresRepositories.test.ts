import { describe, expect, it } from "vitest";
import type { Queryable } from "./postgres.js";
import {
  postgresLicences,
  postgresMemberships,
  postgresRepositories,
  postgresWorkspaces,
} from "./postgresRepositories.js";

/**
 * The control-plane repositories ([ADR-0070](../../../docs/decisions/0070-one-postgres-control-plane.md)).
 *
 * No database: a recording fake answers by statement, which is enough to pin the two
 * things that could go wrong silently — a mapping that turns a missing row into a
 * permissive default, and a statement that stopped being the one `workspaces.ts` owns.
 */

interface Call {
  text: string;
  values: readonly unknown[] | undefined;
}

function fake(rowsFor: (text: string) => unknown[]): Queryable & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: rowsFor(text) };
    },
  };
}

const MEMBER_ROW = {
  id: "m1",
  organizationId: "org-1",
  userId: "user-1",
  role: "owner",
  createdAt: "1800000000000",
};

describe("memberships", () => {
  it("counts and reads a role from Better Auth's own member table", async () => {
    const client = fake((text) => {
      if (text.includes("count(*)")) return [{ count: 3 }];
      if (text.includes("SELECT role")) return [{ role: "admin" }];
      return [MEMBER_ROW];
    });
    const memberships = postgresMemberships(client);

    expect(await memberships.countForOrganization("org-1")).toBe(3);
    expect(await memberships.roleFor("org-1", "user-1")).toBe("admin");

    const listed = await memberships.listForOrganization("org-1");
    expect(listed).toEqual([
      {
        id: "m1",
        organizationId: "org-1",
        userId: "user-1",
        role: "owner",
        createdAt: 1_800_000_000_000,
      },
    ]);
    // Epoch millis, whatever the driver handed back as a string.
    expect(listed[0]?.createdAt).toBe(1_800_000_000_000);
  });

  it("treats a role it does not recognise as no role, rather than trusting a string", async () => {
    const client = fake(() => [{ role: "superuser" }]);

    // Fails closed: a capability is never granted from an unvalidated column.
    expect(await postgresMemberships(client).roleFor("org-1", "user-1")).toBeNull();
  });

  it("drops a member row with an unknown role instead of inventing one", async () => {
    const client = fake(() => [{ ...MEMBER_ROW, role: "ghost" }]);

    expect(await postgresMemberships(client).listForOrganization("org-1")).toEqual([]);
  });
});

describe("licences", () => {
  it("reads the row into a licence the seat check understands", async () => {
    const client = fake(() => [
      {
        licence_id: "lic-1",
        tier: "team",
        workspaces: 5,
        seats: 4,
        document_bytes: "268435456",
        attachment_bytes: "1073741824",
        expires_at: new Date(1_800_086_400_000),
      },
    ]);

    const licence = await postgresLicences(client).forOrganization("org-1");

    expect(licence?.claims.id).toBe("lic-1");
    expect(licence?.seats).toBe(4);
    expect(licence?.claims.workspaces).toBe(5);
    expect(licence?.claims.expiresAt).toBe(1_800_086_400_000);
    // The ceilings are projected by 0004_licence_limits.sql, so a bigint string is
    // read as the number the claims type carries rather than replaced by infinity.
    expect(licence?.claims.documentBytes).toBe(268_435_456);
    expect(licence?.claims.attachmentBytes).toBe(1_073_741_824);
  });

  it("says it imposes no byte ceiling for a row that predates the columns", async () => {
    // A NULL ceiling is "never recorded", not zero (no bytes) and not an error. The
    // relay enforces the signed cap from the token; nothing here reads the field.
    const client = fake(() => [
      {
        licence_id: "lic-1",
        tier: "team",
        workspaces: 5,
        seats: 4,
        document_bytes: null,
        attachment_bytes: null,
        expires_at: "1800086400000",
      },
    ]);

    const licence = await postgresLicences(client).forOrganization("org-1");

    expect(licence?.claims.documentBytes).toBe(Number.POSITIVE_INFINITY);
    expect(licence?.claims.attachmentBytes).toBe(Number.POSITIVE_INFINITY);
  });

  it("answers null when the organization has no licence, so the seat check fails closed", async () => {
    // A missing row granting free sync is the exact bug licenceStateFor exists to
    // prevent, so this is asserted rather than assumed.
    const client = fake(() => []);
    expect(await postgresLicences(client).forOrganization("org-1")).toBeNull();
  });
});

describe("workspaces", () => {
  const workspaceRow = {
    id: "ws-1",
    organization_id: "org-1",
    name: "Client A",
    created_at: "1800000000000",
    archived_at: null,
  };

  it("uses the claim statement the domain owns, not a second copy of it", async () => {
    const client = fake(() => [workspaceRow]);
    const repositories = postgresRepositories(client);

    const claimed = await repositories.workspaces.claim({
      workspaceId: "ws-1",
      organizationId: "org-1",
      name: "Client A",
      now: 1_800_000_000_000,
    });

    const claimCall = client.calls.find((call) => call.text.includes("INSERT INTO workspaces"));
    expect(claimCall).toBeDefined();
    // The conflict clause *is* the claim promise: an owned row must not be stolen.
    expect(claimCall?.text).toContain("ON CONFLICT (id) DO UPDATE");
    expect(claimCall?.text).toContain("WHERE workspaces.organization_id IS NULL");
    // `created_at` is a `timestamptz`: binding the millisecond number is what Postgres
    // rejects with "date/time field value out of range", so the boundary hands it a Date.
    const bound = claimCall?.values?.[3];
    expect(bound).toBeInstanceOf(Date);
    expect((bound as Date).getTime()).toBe(1_800_000_000_000);
    expect(claimed?.workspaceId).toBe("ws-1");
    expect(claimed?.name).toBe("Client A");
  });

  it("reports no row when the claim is refused, which the route turns into a 409", async () => {
    const client = fake(() => []);
    const repositories = postgresRepositories(client);

    const claimed = await repositories.workspaces.claim({
      workspaceId: "ws-1",
      organizationId: "org-2",
      name: "Client A",
      now: 1,
    });

    expect(claimed).toBeNull();
  });

  it("carries the organization's members on a claimed workspace and none on an anonymous one", async () => {
    const client = fake((text) => {
      if (text.includes("FROM member")) return [MEMBER_ROW];
      if (text.includes("FROM workspaces")) {
        return [{ ...workspaceRow, organization_id: null, name: null }];
      }
      return [];
    });

    const found = await postgresWorkspaces(client, postgresMemberships(client)).find("ws-1");

    // An unclaimed workspace has no organization and therefore no members, and a row
    // that predates naming falls back to its id rather than to an empty title.
    expect(found?.organizationId).toBeNull();
    expect(found?.members).toEqual([]);
    expect(found?.name).toBe("ws-1");
  });

  it("does not filter archived rows out of find, because claiming is not resurrection", async () => {
    const client = fake((text) =>
      text.includes("FROM workspaces") ? [{ ...workspaceRow, archived_at: "1800000000000" }] : [],
    );

    const found = await postgresWorkspaces(client, postgresMemberships(client)).find("ws-1");
    const findCall = client.calls.find((call) => call.text.includes("FROM workspaces"));

    expect(found?.workspaceId).toBe("ws-1");
    expect(findCall?.text).not.toContain("archived_at IS NULL");
  });
});
