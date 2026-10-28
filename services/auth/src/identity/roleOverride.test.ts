import { capabilitiesForRole, type MembershipReader, type OrganizationRole } from "@suite/auth";
import { describe, expect, it } from "vitest";
import { withRoleOverride } from "./roleOverride.js";

/**
 * The worn role, proved at the one seam both identity answers read.
 *
 * The bug this prevents is a split brain: an override applied to the session but not to the
 * relay token shows a member's buttons over an owner's powers. Both ask `roleFor`, so what
 * matters here is that the wrapper is the only difference and everything else is untouched.
 */
const ORG = "org-1";
const USER = "user-operator";

function reader(role: OrganizationRole | null): MembershipReader {
  return {
    countForOrganization: async () => 3,
    countForUser: async () => 1,
    roleFor: async () => role,
    listForOrganization: async () => [],
  };
}

describe("wearing a role", () => {
  it("answers the worn role while it lasts", async () => {
    const wrapped = withRoleOverride(reader("owner"), async () => "member");

    expect(await wrapped.roleFor(ORG, USER)).toBe("member");
    // The capabilities follow the answer, which is the whole point.
    expect(capabilitiesForRole((await wrapped.roleFor(ORG, USER)) ?? "member").canManageLinks).toBe(
      false,
    );
  });

  it("returns the real role when there is no override", async () => {
    const wrapped = withRoleOverride(reader("owner"), async () => null);

    expect(await wrapped.roleFor(ORG, USER)).toBe("owner");
  });

  it("hands the reader the real role, so it can decide without asking twice", async () => {
    const seen: (OrganizationRole | null)[] = [];
    const wrapped = withRoleOverride(reader("member"), async ({ role }) => {
      seen.push(role);
      return null;
    });

    await wrapped.roleFor(ORG, USER);

    expect(seen).toEqual(["member"]);
    expect(await wrapped.roleFor(ORG, USER)).toBe("member");
  });

  it("does not invent a role for somebody who is not in the organization", async () => {
    // A worn role is a costume, not a membership: the real row still has to exist for
    // anything to be worn, so a stranger stays a stranger.
    const wrapped = withRoleOverride(reader(null), async ({ role }) => role);

    expect(await wrapped.roleFor(ORG, USER)).toBeNull();
  });

  it("leaves the seat counts alone, because a costume is not a seat", async () => {
    const wrapped = withRoleOverride(reader("member"), async () => "owner");

    expect(await wrapped.countForOrganization(ORG)).toBe(3);
    expect(await wrapped.countForUser(USER)).toBe(1);
    expect(await wrapped.listForOrganization(ORG)).toEqual([]);
  });
});
