import { jsonLogger, type Logger } from "./log.ts";

/**
 * The licence email. There are no accounts, so this message is the only thing
 * that connects a payment to a person: it has to carry the token itself, one
 * line on what the token unlocks, and the way back to self-hosting.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Emailer {
  send(message: EmailMessage): Promise<void>;
}

export interface LicenceEmailInput {
  to: string;
  token: string;
  workspaces: number;
  expiresAt: number;
  licenceId: string;
  selfHostUrl: string;
  renewal: boolean;
}

function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function renderLicenceEmail(input: LicenceEmailInput): EmailMessage {
  const until = isoDay(input.expiresAt);
  const workspaces = `${input.workspaces} workspace${input.workspaces === 1 ? "" : "s"}`;
  const subject = input.renewal
    ? "Your Suite hosted-sync licence has renewed"
    : "Your Suite hosted-sync licence";
  const opening = input.renewal
    ? "Your hosted sync renewed. Here is the current key."
    : "Thanks for buying hosted sync for Suite.";

  const text = [
    opening,
    "",
    "Licence key — paste it into the launcher's licence field:",
    "",
    input.token,
    "",
    `What it unlocks: the hosted relay (sync across your devices, share links and live collaboration) for ${workspaces} until ${until}.`,
    "",
    "The app itself is free and open source, and your files stay yours: if you ever stop paying you can keep editing locally by running the same app yourself.",
    `Self-host it: ${input.selfHostUrl}`,
    "",
    `Licence ${input.licenceId}. Keep this email — it is the only link between the purchase and you.`,
  ].join("\n");

  return { to: input.to, subject, text };
}

export interface ConsoleEmailerOptions {
  log?: Logger;
  /** Print the whole body. For `dev.ts` only; never in the Lambda. */
  includeBody?: boolean;
}

/**
 * Development transport. Logs the fact of the email, never the token, so a
 * Lambda running without SES cannot put a live credential in CloudWatch.
 */
export function consoleEmailer(options: ConsoleEmailerOptions = {}): Emailer {
  const log = options.log ?? jsonLogger;
  return {
    async send(message) {
      log("info", "licence email (console transport)", {
        transport: "console",
        to: message.to,
        subject: message.subject,
        bytes: Buffer.byteLength(message.text, "utf8"),
      });
      if (options.includeBody === true) {
        log("info", "licence email body", { body: message.text });
      }
    },
  };
}

/** The only SDK this service ever loads, and only when an address is set. */
export const SES_MODULE = "@aws-sdk/client-ses";

interface SesEmailInput {
  Source: string;
  Destination: { ToAddresses: string[] };
  Message: {
    Subject: { Data: string; Charset: "UTF-8" };
    Body: { Text: { Data: string; Charset: "UTF-8" } };
  };
}

interface SesSdk {
  SESClient: new (config: { region?: string }) => { send(command: unknown): Promise<unknown> };
  SendEmailCommand: new (input: SesEmailInput) => unknown;
}

export interface SesEmailerOptions {
  /** A verified SES identity, e.g. `licences@example.com`. */
  from: string;
  region?: string;
  log?: Logger;
  /** Injection point for tests; the real path imports the SDK by name. */
  loadSdk?: (moduleName: string) => Promise<unknown>;
}

/**
 * SES transport, loaded on demand: the webhook only needs the SDK when it has
 * an address to send from, so an unconfigured deployment never fails to start
 * because a package is missing.
 */
export async function sesEmailer(options: SesEmailerOptions): Promise<Emailer> {
  const log = options.log ?? jsonLogger;
  const load = options.loadSdk ?? ((moduleName: string) => import(moduleName));

  let sdk: SesSdk;
  try {
    sdk = (await load(SES_MODULE)) as unknown as SesSdk;
  } catch (error) {
    throw new Error(
      `${SES_MODULE} is not installed; run "pnpm add ${SES_MODULE}" in services/billing (the main install stays Stripe- and AWS-free)`,
      { cause: error },
    );
  }
  if (typeof sdk.SESClient !== "function" || typeof sdk.SendEmailCommand !== "function") {
    throw new Error(`${SES_MODULE} does not export SESClient and SendEmailCommand`);
  }

  const client = new sdk.SESClient(options.region === undefined ? {} : { region: options.region });

  return {
    async send(message) {
      const command = new sdk.SendEmailCommand({
        Source: options.from,
        Destination: { ToAddresses: [message.to] },
        Message: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" } },
        },
      });
      await client.send(command);
      log("info", "licence email sent", {
        transport: "ses",
        to: message.to,
        subject: message.subject,
      });
    },
  };
}

/**
 * SES when `SES_FROM_ADDRESS` is configured, otherwise the console transport
 * with a warning. A deployment that forgot SES still issues licences; it just
 * cannot deliver them, and the warning says so on the first event.
 */
export async function emailerFromEnvironment(
  from: string | undefined,
  region: string | undefined,
  log: Logger = jsonLogger,
): Promise<Emailer> {
  const source = from?.trim();
  if (!source) {
    log("warn", "SES_FROM_ADDRESS is not set; licence emails go to the console", {
      transport: "console",
    });
    return consoleEmailer({ log });
  }
  return sesEmailer({
    from: source,
    log,
    ...(region?.trim() ? { region: region.trim() } : {}),
  });
}
