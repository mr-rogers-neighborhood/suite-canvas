import type { MailMessage, MailTransport } from "./mail.js";

/**
 * Resend, over its HTTP API.
 *
 * `fetch` rather than an SDK: one endpoint, one header, and a dependency that would
 * otherwise sit in the sign-up path for every deployment that uses it.
 *
 * A non-2xx answer throws. A sign-up that quietly continues after the verification
 * email failed is a person staring at a screen that will never let them in.
 */
export interface ResendTransportOptions {
  apiKey: string;
  /** The verified sending address, e.g. `Suite <hello@suite.run>`. */
  from: string;
  /** Where a reply should go, when it is not the sending address. */
  replyTo?: string | undefined;
  fetch?: typeof globalThis.fetch;
  endpoint?: string;
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function resendTransport(options: ResendTransportOptions): MailTransport {
  const send = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? RESEND_ENDPOINT;
  return {
    send: async (message: MailMessage) => {
      const response = await send(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          // The plain body carries the link, and a mail client that refuses HTML
          // still gets a usable message.
          text: message.text,
          ...(options.replyTo === undefined ? {} : { reply_to: options.replyTo }),
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend refused a message: ${response.status} ${await response.text()}`);
      }
    },
  };
}
