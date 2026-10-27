import type { InvitationEmail } from "../invitations/enrollment.js";

/**
 * Outbound mail, as one transport behind three named senders.
 *
 * The service never formats or delivers a message itself: it asks for a link to be
 * delivered and this module turns that into a subject, a body, and a call to the
 * transport the deployment supplied. `consoleTransport` is the development
 * transport — it writes the line, link included, so a contributor can click through
 * sign-up without a mail provider. A deployment passes its own `MailTransport`.
 *
 * Email delivery is part of the sign-up path now that sign-up is open (ADR-0077), so
 * the sender is a required dependency rather than a stub that silently accepts a
 * message nobody receives.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send: (message: MailMessage) => Promise<void>;
}

export interface ConsoleTransportOptions {
  /** Where a line goes. Defaults to `console.info`; a test passes a collector. */
  write?: (line: string) => void;
}

/**
 * The development transport: one line per message on stdout, link included.
 *
 * It is deliberately not the default in a deployment. A link is a credential, and
 * stdout is read by every log shipper the host happens to run.
 */
export function consoleTransport(options: ConsoleTransportOptions = {}): MailTransport {
  const write = options.write ?? ((line: string) => console.info(line));
  return {
    send: async (message) => {
      write(`mail to ${message.to}: ${message.subject}\n${message.text}`);
    },
  };
}

/**
 * An organization invitation: the plugin's own flow, which is what "invite a colleague"
 * means now that sign-up is open (ADR-0077).
 *
 * There is no token in the link. The organization plugin identifies an invitation by its
 * id and checks the signed-in account's address against it, so the link is worthless to
 * anyone holding somebody else's mailbox.
 */
export interface OrganizationInvitation {
  id: string;
  email: string;
  role: string;
  organizationName: string;
  inviterName: string;
  url: string;
}

/** A link the mailer carries, plus the token it contains so a caller can log or test it. */
export interface MailLink {
  email: string;
  url: string;
  token: string;
}

/** What the feedback bubble sends: the words, and enough context to reproduce it. */
export interface FeedbackMessage {
  text: string;
  /** Where it was written: the board, the launcher. */
  surface: string;
  /** The release, so a report can be matched to a build. */
  buildId: string;
  /** Whether the sender had an account, which changes what they could reach. */
  signedIn: boolean;
}

export interface MailSenders {
  sendMagicLink: (link: MailLink) => Promise<void>;
  sendVerificationEmail: (link: MailLink) => Promise<void>;
  /** An operator let this address in. Sent once, when the queue moves (ADR-0067 §7). */
  sendAdmissionGranted: (recipient: { email: string; appUrl: string }) => Promise<void>;
  sendInvitation: (invitation: InvitationEmail) => Promise<void>;
  sendOrganizationInvitation: (invitation: OrganizationInvitation) => Promise<void>;
  /** A message from the feedback bubble, to the operator's desk. */
  sendFeedback: (message: FeedbackMessage) => Promise<void>;
}

/** Where the operator wants feedback to arrive; absent, the sender refuses. */
export interface MailSenderOptions {
  feedbackTo?: string | undefined;
}

export function mailSenders(
  transport: MailTransport,
  options: MailSenderOptions = {},
): MailSenders {
  return {
    sendMagicLink: async ({ email, url }) => {
      await transport.send({
        to: email,
        subject: "Your Suite sign-in link",
        text: [
          "Open this link to sign in to Suite.",
          "",
          url,
          "",
          "The link works once and expires in 10 minutes.",
          "If you did not ask for it, ignore this message.",
        ].join("\n"),
      });
    },
    sendVerificationEmail: async ({ email, url }) => {
      await transport.send({
        to: email,
        subject: "Confirm your Suite email",
        text: [
          "Open this link to confirm this address and finish creating your account.",
          "",
          url,
          "",
          "If you did not create an account, ignore this message and nothing happens.",
        ].join("\n"),
      });
    },
    sendAdmissionGranted: async ({ email, appUrl }) => {
      await transport.send({
        to: email,
        subject: "Your Suite workspace is ready",
        text: [
          "Your account has been approved. Sign in and your workspace is ready to sync.",
          "",
          appUrl,
          "",
          "Anything you wrote before signing up is still on the device you wrote it on.",
          "Sign in there to bring it with you.",
        ].join("\n"),
      });
    },
    sendFeedback: async (message) => {
      const to = options.feedbackTo?.trim();
      // No desk, no message: silently dropping it would tell the sender their
      // words arrived when nothing left the process.
      if (to === undefined || to.length === 0) {
        throw new Error("SUITE_FEEDBACK_TO is not set, so there is nowhere to send feedback");
      }
      await transport.send({
        to,
        subject: `Suite feedback (${message.buildId})`,
        text: [
          message.text,
          "",
          `— from the ${message.surface}, build ${message.buildId},`,
          message.signedIn ? "signed in" : "not signed in",
        ].join("\n"),
      });
    },
    sendOrganizationInvitation: async (invitation) => {
      await transport.send({
        to: invitation.email,
        subject: `${invitation.inviterName} invited you to ${invitation.organizationName}`,
        text: [
          `${invitation.inviterName} invited you to join ${invitation.organizationName} as ${invitation.role}.`,
          "",
          invitation.url,
          "",
          "Sign in with this address, then open the link to accept.",
        ].join("\n"),
      });
    },
    sendInvitation: async (invitation) => {
      const organization = invitation.organizationName ?? "Suite";
      await transport.send({
        to: invitation.email,
        subject: `${invitation.inviterName} invited you to ${organization}`,
        text: [
          `${invitation.inviterName} (${invitation.inviterEmail}) invited you to join ${organization}.`,
          "",
          invitation.url,
          "",
          "Opening the link asks you to choose a password, which becomes your way back in.",
        ].join("\n"),
      });
    },
  };
}
