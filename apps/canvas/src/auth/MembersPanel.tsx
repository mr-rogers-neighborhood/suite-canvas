import { useCallback, useEffect, useState } from "react";
import {
  cancelInvitation,
  type InvitationView,
  inviteMember,
  listInvitations,
  listMembers,
  type MemberView,
  removeMember,
  updateMemberRole,
} from "./members";
import type { OrganizationRole } from "./organization";
import { noteRefusal } from "./refusal";

/**
 * Members, roles and invitations (ADR-0077).
 *
 * An invitation here adds a colleague to an organization that already pays; it is
 * not how a stranger gets an account, because sign-up is open. The seat count is
 * the server's call — a full plan answers with a refusal, and this panel says so
 * rather than showing a form that keeps failing.
 */

const ROLES: readonly OrganizationRole[] = ["owner", "admin", "member"];

const ROLE_COPY: Record<OrganizationRole, string> = {
  owner: "Owner — billing, members and every workspace",
  admin: "Admin — members and every workspace",
  member: "Member — the workspaces they are given",
};

export interface MembersPanelProps {
  /** Overrides the reads; tests supply their own. */
  api?: {
    listMembers: typeof listMembers;
    listInvitations: typeof listInvitations;
    inviteMember: typeof inviteMember;
    cancelInvitation: typeof cancelInvitation;
    updateMemberRole: typeof updateMemberRole;
    removeMember: typeof removeMember;
  };
}

const liveApi = {
  listMembers,
  listInvitations,
  inviteMember,
  cancelInvitation,
  updateMemberRole,
  removeMember,
};

export function MembersPanel({ api = liveApi }: MembersPanelProps) {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [people, invites] = await Promise.all([api.listMembers(), api.listInvitations()]);
    if (people.ok) setMembers(people.value);
    else setError(people.message);
    if (invites.ok) setInvitations(invites.value.filter((entry) => entry.status === "pending"));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.inviteMember({ email, role });
    setBusy(false);
    if (!result.ok) {
      // A full seat count is the plan's answer, so offer the plan.
      noteRefusal(result.code);
      setError(result.message);
      return;
    }
    setEmail("");
    setNotice(`Invited ${result.value.email}. The link is bound to that address.`);
    void load();
  };

  const changeRole = async (member: MemberView, next: OrganizationRole) => {
    setBusy(true);
    setError(null);
    const result = await api.updateMemberRole({ memberId: member.id, role: next });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    void load();
  };

  const remove = async (member: MemberView) => {
    setBusy(true);
    setError(null);
    const result = await api.removeMember(member.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    void load();
  };

  return (
    <div data-testid="members-panel" className="text-[12px]">
      <h3 className="text-[13px] font-semibold">Members</h3>
      <ul data-testid="members-list" className="mt-1 divide-y divide-[var(--hairline)]">
        {members.length === 0 ? (
          <li className="py-2 text-[var(--ink-muted)]">
            Nobody else is in this workspace space yet.
          </li>
        ) : (
          members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate" title={member.email ?? member.userId}>
                {member.email ?? member.name ?? "A member"}
              </span>
              <select
                aria-label={`Role for ${member.email ?? member.userId}`}
                data-testid={`member-role-${member.id}`}
                value={member.role}
                disabled={busy}
                onChange={(event) =>
                  void changeRole(member, event.target.value as OrganizationRole)
                }
                className="rounded border border-[var(--hairline)] bg-transparent px-1 py-0.5 text-[11px]"
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid={`member-remove-${member.id}`}
                disabled={busy}
                onClick={() => void remove(member)}
                className="rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-500/15"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>

      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Invite someone
      </h4>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          data-testid="member-invite-email"
          type="email"
          aria-label="Email address to invite"
          placeholder="colleague@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--hairline)] bg-transparent px-2 py-1"
        />
        <select
          data-testid="member-invite-role"
          aria-label="Role for the invitation"
          value={role}
          onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "member")}
          className="rounded border border-[var(--hairline)] bg-transparent px-1 py-1 text-[11px]"
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          data-testid="member-invite-submit"
          disabled={busy || email.trim().length === 0}
          onClick={() => void invite()}
          className="rounded bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] disabled:opacity-50"
        >
          Invite
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
        An invitation adds someone to this workspace space. It is not how an account is created —
        they can sign up on their own.
      </p>

      {invitations.length > 0 ? (
        <>
          <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Waiting to be accepted
          </h4>
          <ul data-testid="invitations-list" className="mt-1 divide-y divide-[var(--hairline)]">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate" title={invitation.email}>
                  {invitation.email} · {invitation.role}
                </span>
                <button
                  type="button"
                  data-testid={`invitation-cancel-${invitation.id}`}
                  disabled={busy}
                  onClick={() => void api.cancelInvitation(invitation.id).then(() => load())}
                  className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                >
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ul className="mt-3 space-y-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
        {ROLES.map((option) => (
          <li key={option}>{ROLE_COPY[option]}</li>
        ))}
      </ul>

      {notice === null ? null : (
        <p role="status" data-testid="members-notice" className="mt-2 text-[11px]">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <p
          role="alert"
          data-testid="members-error"
          className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-800 dark:text-red-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}
