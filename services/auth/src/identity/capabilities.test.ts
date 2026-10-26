import { describe, expect, it } from "vitest";
import { capabilitiesForPrincipal, capabilitiesForRole } from "./capabilities.js";

/**
 * The matrix is the only place Better Auth's three roles become the app's nine
 * flags, so the tests are about *behaviour a surface would notice*: who can
 * delete a board, who can touch the schema, who can hand out a link. They are
 * deliberately not a mirror of the object literal.
 */
describe("capabilitiesForRole", () => {
  it("gives an owner the whole workspace surface, including links", () => {
    const owner = capabilitiesForRole("owner");
    expect(owner.canManageLinks).toBe(true);
    expect(owner.canManageSchema).toBe(true);
    expect(owner.canManageTrash).toBe(true);
    expect(owner.canEditLayout).toBe(true);
    expect(owner.canCreateBoards).toBe(true);
  });

  it("gives an admin the live editing surface and link management, but not ownership", () => {
    const admin = capabilitiesForRole("admin");
    expect(admin.canEditContent).toBe(true);
    expect(admin.canEditLayout).toBe(true);
    expect(admin.canCreateBoards).toBe(true);
    expect(admin.canManageBoards).toBe(true);
    expect(admin.canManageLinks).toBe(true);
  });

  it("gives a member content, and nothing workspace-shaped", () => {
    const member = capabilitiesForRole("member");
    expect(member.canEditContent).toBe(true);
    expect(member.canCreateContent).toBe(true);
    expect(member.canEditLayout).toBe(false);
    expect(member.canCreateBoards).toBe(false);
    expect(member.canManageBoards).toBe(false);
    expect(member.canManageSchema).toBe(false);
    expect(member.canManageTrash).toBe(false);
    expect(member.canManageLinks).toBe(false);
  });

  it("never grants publish: publishing is for share drafts, not organization members", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(capabilitiesForRole(role).canPublish).toBe(false);
    }
  });

  it("hands out a copy, so a caller cannot promote itself by mutation", () => {
    const member = capabilitiesForRole("member");
    member.canManageLinks = true;
    expect(capabilitiesForRole("member").canManageLinks).toBe(false);
  });

  it("treats a share or owner principal as the workspace owner it already is", () => {
    expect(capabilitiesForPrincipal({ kind: "owner", workspaceId: "ws" }).canManageLinks).toBe(
      true,
    );
    expect(capabilitiesForPrincipal({ kind: "share", workspaceId: "ws" }).canManageLinks).toBe(
      true,
    );
    expect(
      capabilitiesForPrincipal({
        kind: "account",
        workspaceId: "ws",
        organizationId: "o",
        userId: "u",
        role: "member",
      }).canManageLinks,
    ).toBe(false);
  });
});
