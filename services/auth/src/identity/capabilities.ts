import type { OrganizationRole, Principal } from "../types.js";

/**
 * The nine capability flags the app already gates every surface with. This is a
 * structural mirror of `SessionCapabilities` in
 * `apps/canvas/src/session/session.ts`: a service must not import from an app,
 * and the browser can assign this object straight onto that interface.
 *
 * `canPublish` is false for every organization role on purpose — publishing
 * exists for share *drafts*, and a member of the organization edits the live
 * workspace. The one role that cannot exist here is the board-draft editor.
 */
export interface WorkspaceCapabilities {
  canEditContent: boolean;
  canEditLayout: boolean;
  canPublish: boolean;
  canCreateContent: boolean;
  canCreateBoards: boolean;
  canManageBoards: boolean;
  canManageSchema: boolean;
  canManageTrash: boolean;
  canManageLinks: boolean;
}

const OWNER: WorkspaceCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: true,
};

/**
 * An admin is the workspace *editor* the security model already describes: the
 * whole live surface (boards, types, tags, trash) plus link management. It is
 * not the owner because it cannot delete the workspace, move ownership, or hold
 * the licence — those are organization-level acts.
 */
const ADMIN: WorkspaceCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: true,
};

/**
 * A member is "viewer plus content": titles, bodies, properties, and new cards.
 * Layout, boards, schema, trash and links stay with an admin, because each of
 * those is a workspace-shaped decision a tester was not invited to make.
 */
const MEMBER: WorkspaceCapabilities = {
  canEditContent: true,
  canEditLayout: false,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: false,
  canManageBoards: false,
  canManageSchema: false,
  canManageTrash: false,
  canManageLinks: false,
};

const BY_ROLE: Readonly<Record<OrganizationRole, WorkspaceCapabilities>> = {
  owner: OWNER,
  admin: ADMIN,
  member: MEMBER,
};

/**
 * The one and only role → capability mapping (ADR-0065 amendment §2).
 *
 * Each role gets its own frozen object rather than sharing one, so a caller
 * that mutates what it receives cannot raise another role's privileges.
 */
export function capabilitiesForRole(role: OrganizationRole): WorkspaceCapabilities {
  return { ...BY_ROLE[role] };
}

/** A share link is a capability, not a role: it grants exactly what it always granted. */
export function capabilitiesForPrincipal(principal: Principal): WorkspaceCapabilities {
  return principal.kind === "account"
    ? capabilitiesForRole(principal.role)
    : capabilitiesForRole("owner");
}
