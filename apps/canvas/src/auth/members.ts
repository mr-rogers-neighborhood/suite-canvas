/**
 * Members and invitations (ADR-0077).
 *
 * Invitations are an **organization** feature here: adding a colleague to a team
 * that already pays. Sign-up is open, so an invitation is never how a stranger
 * gets an account — it is how they join somebody's workspace.
 *
 * The seat count is the organization's business, checked server-side against the
 * plan on every member and invitation write; a refusal is reported as the upgrade
 * it is rather than as a failed click.
 */

import { authClient } from "./client";
import {
  codeOf,
  ensureOrganization,
  ORGANIZATION_NAME,
  type OrganizationRole,
} from "./organization";

/** One member row, as the panel lists it. */
export interface MemberView {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: OrganizationRole;
  /** Epoch milliseconds the row was created, when the server sends one. */
  joinedAt: number | null;
}

export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";

/** An outstanding invitation, so the owner can see who has not answered yet. */
export interface InvitationView {
  id: string;
  email: string;
  role: OrganizationRole;
  status: InvitationStatus;
  expiresAt: number | null;
}

export type MembersResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

function roleOf(value: unknown): OrganizationRole {
  return value === "owner" || value === "admin" ? value : "member";
}

function failure(error: unknown, fallback: string): { ok: false; code: string; message: string } {
  const message =
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
      ? ((error as { message: string }).message ?? fallback)
      : fallback;
  return { ok: false, code: codeOf(error), message };
}

/** The organization this panel acts in, created if the account has none. */
async function organizationId(): Promise<MembersResult<string>> {
  const answer = await ensureOrganization(ORGANIZATION_NAME);
  return answer.ok
    ? { ok: true, value: answer.organizationId }
    : { ok: false, code: answer.code, message: answer.message };
}

export async function listMembers(): Promise<MembersResult<MemberView[]>> {
  const org = await organizationId();
  if (!org.ok) return org;
  try {
    const listed = await authClient.organization.listMembers({
      query: { organizationId: org.value },
    });
    if (listed.error || !listed.data) return failure(listed.error, "Members could not be read.");
    const rows = Array.isArray(listed.data.members) ? listed.data.members : [];
    return {
      ok: true,
      value: rows.flatMap((entry): MemberView[] => {
        const id = typeof entry.id === "string" ? entry.id : null;
        if (id === null) return [];
        const joined = (entry as { createdAt?: unknown }).createdAt;
        return [
          {
            id,
            userId: typeof entry.userId === "string" ? entry.userId : "",
            email: typeof entry.user?.email === "string" ? entry.user.email : null,
            name: typeof entry.user?.name === "string" ? entry.user.name : null,
            role: roleOf(entry.role),
            joinedAt:
              joined instanceof Date
                ? joined.getTime()
                : typeof joined === "string"
                  ? Date.parse(joined) || null
                  : null,
          },
        ];
      }),
    };
  } catch (error) {
    return failure(error, "Members could not be read.");
  }
}

export async function inviteMember(input: {
  email: string;
  role: Exclude<OrganizationRole, "owner">;
}): Promise<MembersResult<{ email: string }>> {
  const org = await organizationId();
  if (!org.ok) return org;
  try {
    const created = await authClient.organization.inviteMember({
      email: input.email.trim(),
      role: input.role,
      organizationId: org.value,
    });
    if (created.error) return failure(created.error, "That invitation could not be sent.");
    return { ok: true, value: { email: input.email.trim() } };
  } catch (error) {
    return failure(error, "That invitation could not be sent.");
  }
}

export async function cancelInvitation(invitationId: string): Promise<MembersResult<true>> {
  const org = await organizationId();
  if (!org.ok) return org;
  try {
    const result = await authClient.organization.cancelInvitation({ invitationId });
    if (result.error) return failure(result.error, "That invitation could not be withdrawn.");
    return { ok: true, value: true };
  } catch (error) {
    return failure(error, "That invitation could not be withdrawn.");
  }
}

export async function listInvitations(): Promise<MembersResult<InvitationView[]>> {
  const org = await organizationId();
  if (!org.ok) return org;
  try {
    const listed = await authClient.organization.listInvitations({
      query: { organizationId: org.value },
    });
    if (listed.error || !Array.isArray(listed.data)) {
      return failure(listed.error, "Invitations could not be read.");
    }
    return {
      ok: true,
      value: listed.data.flatMap((entry): InvitationView[] => {
        const id = typeof entry.id === "string" ? entry.id : null;
        if (id === null) return [];
        const status = entry.status;
        const expires = (entry as { expiresAt?: unknown }).expiresAt;
        return [
          {
            id,
            email: typeof entry.email === "string" ? entry.email : "",
            role: roleOf(entry.role),
            status:
              status === "accepted" ||
              status === "rejected" ||
              status === "canceled" ||
              status === "pending"
                ? status
                : "pending",
            expiresAt:
              expires instanceof Date
                ? expires.getTime()
                : typeof expires === "string"
                  ? Date.parse(expires) || null
                  : null,
          },
        ];
      }),
    };
  } catch (error) {
    return failure(error, "Invitations could not be read.");
  }
}

export async function updateMemberRole(input: {
  memberId: string;
  role: OrganizationRole;
}): Promise<MembersResult<true>> {
  const org = await organizationId();
  if (!org.ok) return org;
  try {
    const result = await authClient.organization.updateMemberRole({
      memberId: input.memberId,
      role: input.role,
      organizationId: org.value,
    });
    if (result.error) return failure(result.error, "That role could not be changed.");
    return { ok: true, value: true };
  } catch (error) {
    return failure(error, "That role could not be changed.");
  }
}

export async function removeMember(memberIdOrEmail: string): Promise<MembersResult<true>> {
  const org = await organizationId();
  if (!org.ok) return org;
  try {
    const result = await authClient.organization.removeMember({
      memberIdOrEmail,
      organizationId: org.value,
    });
    if (result.error) return failure(result.error, "That member could not be removed.");
    return { ok: true, value: true };
  } catch (error) {
    return failure(error, "That member could not be removed.");
  }
}
