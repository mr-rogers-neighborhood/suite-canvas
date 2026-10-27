/** Mail: the transport a deployment supplies, and the senders the service calls. */
export {
  type ConsoleTransportOptions,
  consoleTransport,
  type MailLink,
  type MailMessage,
  type MailSenders,
  type MailTransport,
  mailSenders,
} from "./mail.js";
export { RESEND_ENDPOINT, type ResendTransportOptions, resendTransport } from "./resend.js";
export { type MailEnv, mailTransportFromEnv } from "./select.js";
export { type SmtpTransportOptions, sendSmtp, smtpTransport } from "./smtp.js";
