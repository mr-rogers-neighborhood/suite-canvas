import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MembersPanel } from "./MembersPanel";

const OWNER = {
  id: "member-1",
  userId: "user-1",
  email: "owner@example.com",
  name: "Ada",
  role: "owner" as const,
  joinedAt: 1_000,
};

const MEMBER = {
  id: "member-2",
  userId: "user-2",
  email: "reader@example.com",
  name: null,
  role: "member" as const,
  joinedAt: 2_000,
};

function api(overrides: Record<string, unknown> = {}) {
  return {
    listMembers: vi.fn(async () => ({ ok: true as const, value: [OWNER, MEMBER] })),
    listInvitations: vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          id: "inv-1",
          email: "pending@example.com",
          role: "member" as const,
          status: "pending" as const,
          expiresAt: null,
        },
        {
          id: "inv-2",
          email: "done@example.com",
          role: "member" as const,
          status: "accepted" as const,
          expiresAt: null,
        },
      ],
    })),
    inviteMember: vi.fn(async ({ email }: { email: string }) => ({
      ok: true as const,
      value: { email },
    })),
    cancelInvitation: vi.fn(async () => ({ ok: true as const, value: true as const })),
    updateMemberRole: vi.fn(async () => ({ ok: true as const, value: true as const })),
    removeMember: vi.fn(async () => ({ ok: true as const, value: true as const })),
    ...overrides,
  };
}

describe("members and invitations", () => {
  it("lists the people with their roles, and only the invitations still waiting", async () => {
    render(<MembersPanel api={api()} />);

    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("reader@example.com")).toBeInTheDocument();
    expect(screen.getByTestId(`member-role-${MEMBER.id}`)).toHaveValue("member");
    // An accepted invitation is history, not something to withdraw.
    expect(screen.getByText(/pending@example.com/)).toBeInTheDocument();
    expect(screen.queryByText(/done@example.com/)).not.toBeInTheDocument();
  });

  it("invites an address with the chosen role", async () => {
    const client = api();
    render(<MembersPanel api={client} />);
    await screen.findByText("owner@example.com");

    fireEvent.change(screen.getByTestId("member-invite-email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByTestId("member-invite-role"), { target: { value: "admin" } });
    fireEvent.click(screen.getByTestId("member-invite-submit"));

    await waitFor(() =>
      expect(client.inviteMember).toHaveBeenCalledWith({ email: "new@example.com", role: "admin" }),
    );
    expect(await screen.findByTestId("members-notice")).toHaveTextContent("bound to that address");
  });

  it("reports a full plan as the refusal it is", async () => {
    const client = api({
      inviteMember: vi.fn(async () => ({
        ok: false as const,
        code: "seat-refused",
        message: "This plan has no seat left.",
      })),
    });
    render(<MembersPanel api={client} />);
    await screen.findByText("owner@example.com");

    fireEvent.change(screen.getByTestId("member-invite-email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByTestId("member-invite-submit"));

    expect(await screen.findByTestId("members-error")).toHaveTextContent("no seat left");
  });

  it("changes a role and removes a member", async () => {
    const client = api();
    render(<MembersPanel api={client} />);
    await screen.findByText("reader@example.com");

    fireEvent.change(screen.getByTestId(`member-role-${MEMBER.id}`), {
      target: { value: "admin" },
    });
    await waitFor(() =>
      expect(client.updateMemberRole).toHaveBeenCalledWith({
        memberId: MEMBER.id,
        role: "admin",
      }),
    );

    fireEvent.click(screen.getByTestId(`member-remove-${MEMBER.id}`));
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith(MEMBER.id));
  });

  it("says invitations are not how an account is created", async () => {
    render(<MembersPanel api={api()} />);
    expect(await screen.findByTestId("members-panel")).toHaveTextContent(
      "not how an account is created",
    );
  });
});
