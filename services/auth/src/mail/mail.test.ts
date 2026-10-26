import { describe, expect, it } from "vitest";
import type { InvitationEmail } from "../invitations/enrollment.js";
import { consoleTransport, type MailMessage, mailSenders } from "./mail.js";

/**
 * The senders, over a recording transport.
 *
 * Email is part of the sign-up path now that the form is open (ADR-0077), so what
 * matters is that each sender is a real message with the link in it and the right
 * recipient — not a stub that accepts anything.
 */
function sender(): { sent: MailMessage[]; senders: ReturnType<typeof mailSenders> } {
  const sent: MailMessage[] = [];
  return {
    sent,
    senders: mailSenders({
      send: async (message) => {
        sent.push(message);
      },
    }),
  };
}

const invitation: InvitationEmail = {
  email: "colleague@example.com",
  name: null,
  url: "https://suite.example/invite?token=t0ken",
  token: "t0ken",
  organizationName: "Agency",
  organizationRole: "member",
  inviteId: "invite-1",
  inviterName: "Ada",
  inviterEmail: "ada@example.com",
  expiresAt: 1_760_000_000_000,
};

describe("the console transport", () => {
  it("writes one line naming the recipient and carrying the body", async () => {
    const lines: string[] = [];
    await consoleTransport({ write: (line) => lines.push(line) }).send({
      to: "a@example.com",
      subject: "Subject",
      text: "body",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("mail to a@example.com: Subject\nbody");
  });
});

describe("the senders", () => {
  it("delivers a verification link to the address that signed up", async () => {
    const { sent, senders } = sender();
    await senders.sendVerificationEmail({
      email: "stranger@example.com",
      url: "https://suite.example/api/auth/verify-email?token=v1",
      token: "v1",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("stranger@example.com");
    expect(sent[0]?.text).toContain("verify-email?token=v1");
  });

  it("delivers a magic link", async () => {
    const { sent, senders } = sender();
    await senders.sendMagicLink({
      email: "reader@example.com",
      url: "https://suite.example/api/auth/magic-link/verify?token=m1",
      token: "m1",
    });

    expect(sent[0]?.subject).toBe("Your Suite sign-in link");
    expect(sent[0]?.text).toContain("magic-link/verify?token=m1");
  });

  it("delivers an invitation, naming the inviter and the organization", async () => {
    const { sent, senders } = sender();
    await senders.sendInvitation(invitation);

    expect(sent[0]?.to).toBe("colleague@example.com");
    expect(sent[0]?.subject).toBe("Ada invited you to Agency");
    expect(sent[0]?.text).toContain(invitation.url);
  });
});
