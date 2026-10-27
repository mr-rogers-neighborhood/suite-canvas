import { connect as netConnect } from "node:net";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import type { MailMessage, MailTransport } from "./mail.js";

/**
 * SMTP, for a deployment that already runs a relay.
 *
 * A self-hoster who has a mailbox on their own server should not need an account
 * with a vendor to receive a login link, and that is the whole reason this exists.
 *
 * It speaks the subset a submission server needs: EHLO, STARTTLS or implicit TLS,
 * AUTH PLAIN or AUTH LOGIN, one message. It is deliberately not a general SMTP
 * client: no pipelining, no DSN, no bounce parsing.
 */

export interface SmtpTransportOptions {
  /** `smtp://user:pass@host:587`, or `smtps://host:465` for implicit TLS. */
  url: string;
  from: string;
  /** Start TLS when the server offers it. On by default; a local relay may not have it. */
  requireTls?: boolean;
  timeoutMs?: number;
}

interface SmtpSession {
  write: (data: string) => void;
  read: () => Promise<string>;
  close: () => void;
}

/** A reply line's numeric code, or 0 when the line is not one. */
function codeOf(line: string): number {
  const match = /^(\d{3})/.exec(line);
  return match ? Number(match[1]) : 0;
}

/** Reads until a line arrives whose fourth character is not `-` (a multi-line reply). */
async function reply(session: SmtpSession): Promise<string> {
  let line = await session.read();
  const lines = [line];
  while (line.length > 3 && line[3] === "-") {
    line = await session.read();
    lines.push(line);
  }
  return lines.join("\n");
}

function expectOk(step: string, answer: string, allowed: readonly number[]): void {
  const code = codeOf(answer);
  if (!allowed.includes(code)) {
    throw new Error(`SMTP ${step} failed: ${answer.trim()}`);
  }
}

/** `AUTH PLAIN`'s base64 of NUL, user, NUL, password. */
function plainToken(user: string, password: string): string {
  return Buffer.from(`\u0000${user}\u0000${password}`, "utf8").toString("base64");
}

interface Target {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  implicitTls: boolean;
}

function parseUrl(url: string): Target {
  const parsed = new URL(url);
  const implicitTls = parsed.protocol === "smtps:";
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : implicitTls ? 465 : 587,
    user: parsed.username ? decodeURIComponent(parsed.username) : null,
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
    implicitTls,
  };
}

/**
 * Lines arrive in chunks and are consumed one reply at a time, so they are queued
 * rather than handed straight to whoever happens to be waiting.
 */
function sessionOver(stream: Duplex, label: string, timeoutMs: number): SmtpSession {
  let buffer = "";
  const queued: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let closed = false;

  const deliver = (line: string) => {
    const resolve = waiting.shift();
    if (resolve === undefined) queued.push(line);
    else resolve(line);
  };

  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\r\n");
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      deliver(line);
      index = buffer.indexOf("\r\n");
    }
  });
  const finish = () => {
    closed = true;
    while (waiting.length > 0) waiting.shift()?.("");
  };
  stream.on("close", finish);
  stream.on("error", finish);

  return {
    write: (data) => {
      if (!stream.destroyed) stream.write(data);
    },
    read: () =>
      new Promise<string>((resolve, reject) => {
        const queuedLine = queued.shift();
        if (queuedLine !== undefined) {
          resolve(queuedLine);
          return;
        }
        if (closed) {
          reject(new Error(`SMTP ${label} closed`));
          return;
        }
        const timer = setTimeout(() => reject(new Error(`SMTP ${label} timed out`)), timeoutMs);
        waiting.push((line) => {
          clearTimeout(timer);
          if (line === "" && closed) reject(new Error(`SMTP ${label} closed`));
          else resolve(line);
        });
      }),
    // `end` rather than `destroy`: the last write has to reach the server before
    // the connection goes away, or a relay answers "lost connection" instead of 250.
    close: () => {
      if (!stream.destroyed) stream.end();
    },
  };
}

/**
 * Delivers one message.
 *
 * Exported so a test can drive it against a real server rather than a mock of one:
 * the protocol is the thing under test, not our call to it.
 */
export async function sendSmtp(options: SmtpTransportOptions, message: MailMessage): Promise<void> {
  const target = parseUrl(options.url);
  const address = /<([^>]+)>/.exec(options.from)?.[1] ?? options.from.trim();
  let stream: Duplex = target.implicitTls
    ? tlsConnect({ host: target.host, port: target.port, servername: target.host })
    : netConnect({ host: target.host, port: target.port });
  let session = sessionOver(stream, "connect", options.timeoutMs ?? 15_000);
  try {
    expectOk("greeting", await reply(session), [220]);
    session.write(`EHLO ${target.host}\r\n`);
    let capabilities = await reply(session);
    expectOk("EHLO", capabilities, [250]);

    if (!target.implicitTls) {
      if (/STARTTLS/i.test(capabilities)) {
        session.write("STARTTLS\r\n");
        expectOk("STARTTLS", await reply(session), [220]);
        // The TLS socket takes the connection over; from here the exchange is on
        // the wrapped stream, so the session is replaced rather than mutated.
        stream.removeAllListeners("data");
        stream.removeAllListeners("close");
        stream = tlsConnect({ socket: stream, servername: target.host });
        session = sessionOver(stream, "STARTTLS", options.timeoutMs ?? 15_000);
        session.write(`EHLO ${target.host}\r\n`);
        capabilities = await reply(session);
        expectOk("EHLO after TLS", capabilities, [250]);
      } else if (options.requireTls === true) {
        throw new Error("SMTP refused STARTTLS and TLS is required");
      }
    }

    if (target.user !== null && target.password !== null) {
      const mechanisms = /AUTH ([^\r\n]*)/i.exec(capabilities)?.[1] ?? "";
      if (/PLAIN/i.test(mechanisms)) {
        session.write(`AUTH PLAIN ${plainToken(target.user, target.password)}\r\n`);
        expectOk("AUTH PLAIN", await reply(session), [235]);
      } else {
        session.write("AUTH LOGIN\r\n");
        expectOk("AUTH LOGIN", await reply(session), [334]);
        session.write(`${Buffer.from(target.user, "utf8").toString("base64")}\r\n`);
        expectOk("AUTH user", await reply(session), [334]);
        session.write(`${Buffer.from(target.password, "utf8").toString("base64")}\r\n`);
        expectOk("AUTH password", await reply(session), [235]);
      }
    }

    session.write(`MAIL FROM:<${address}>\r\n`);
    expectOk("MAIL FROM", await reply(session), [250]);
    session.write(`RCPT TO:<${message.to}>\r\n`);
    expectOk("RCPT TO", await reply(session), [250, 251]);
    session.write("DATA\r\n");
    expectOk("DATA", await reply(session), [354]);

    const headers = [
      `From: ${options.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      `Date: ${new Date().toUTCString()}`,
    ];
    // Dot-stuffing, then the terminator on its own line.
    const body = message.text.replace(/^\./gm, "..");
    session.write(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.\r\n`);
    expectOk("end of message", await reply(session), [250]);
    session.write("QUIT\r\n");
    session.close();
  } catch (error) {
    session.close();
    throw error;
  }
}

export function smtpTransport(options: SmtpTransportOptions): MailTransport {
  return { send: (message) => sendSmtp(options, message) };
}
