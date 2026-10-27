import { consoleTransport, type MailTransport } from "./mail.js";
import { resendTransport } from "./resend.js";
import { smtpTransport } from "./smtp.js";

/**
 * The transport a deployment asked for, or a refusal.
 *
 * A wrong answer here does not degrade: sign-up stops. So an unset or unreadable
 * value throws at boot rather than falling back to the console transport, which
 * would look healthy while every verification email went to a log file.
 */
export type MailEnv = {
  SUITE_MAIL_TRANSPORT?: string | undefined;
  SUITE_MAIL_FROM?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  SUITE_SMTP_URL?: string | undefined;
  SUITE_SMTP_REQUIRE_TLS?: string | undefined;
};

export function mailTransportFromEnv(
  env: MailEnv,
  options: { write?: (line: string) => void } = {},
): MailTransport {
  const kind = env.SUITE_MAIL_TRANSPORT?.trim() || "console";
  if (kind === "console") {
    return consoleTransport(options.write === undefined ? {} : { write: options.write });
  }

  const from = env.SUITE_MAIL_FROM?.trim();
  if (from === undefined || from === "") {
    throw new Error(`SUITE_MAIL_TRANSPORT=${kind} needs SUITE_MAIL_FROM`);
  }

  if (kind === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (apiKey === undefined || apiKey === "") {
      throw new Error("SUITE_MAIL_TRANSPORT=resend needs RESEND_API_KEY");
    }
    return resendTransport({ apiKey, from });
  }

  if (kind === "smtp") {
    const url = env.SUITE_SMTP_URL?.trim();
    if (url === undefined || url === "") {
      throw new Error("SUITE_MAIL_TRANSPORT=smtp needs SUITE_SMTP_URL");
    }
    return smtpTransport({
      url,
      from,
      requireTls: env.SUITE_SMTP_REQUIRE_TLS !== "0",
    });
  }

  throw new Error(`SUITE_MAIL_TRANSPORT=${kind} is not one of console, resend, smtp`);
}
