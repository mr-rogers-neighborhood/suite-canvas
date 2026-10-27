import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resendTransport } from "./resend.js";
import { mailTransportFromEnv } from "./select.js";
import { sendSmtp } from "./smtp.js";

/**
 * The two real transports.
 *
 * Resend is tested against a recording `fetch`, and SMTP against a socket that
 * speaks the protocol back. A mock of `sendSmtp` would prove nothing: the exchange
 * with the server is the whole implementation.
 */

describe("resend", () => {
  it("posts the message with the key and the sender", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{"id":"abc"}', { status: 200 });
    }) as typeof globalThis.fetch;

    await resendTransport({ apiKey: "re_key", from: "Suite <hello@suite.run>", fetch }).send({
      to: "person@example.com",
      subject: "Confirm your address",
      text: "https://app.suite.run/verify?token=t",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_key");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      from: "Suite <hello@suite.run>",
      to: ["person@example.com"],
      subject: "Confirm your address",
      text: "https://app.suite.run/verify?token=t",
    });
  });

  it("refuses to pretend a rejected message was sent", async () => {
    const fetch = (async () =>
      new Response("domain not verified", { status: 403 })) as typeof globalThis.fetch;
    await expect(
      resendTransport({ apiKey: "k", from: "a@b.c", fetch }).send({
        to: "x@y.z",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow(/403/);
  });
});

/** A server that answers enough of SMTP for one message, and records what it heard. */
function fakeSmtp(options: { authMechanisms: string }): Promise<{
  url: string;
  heard: string[];
  messages: string[];
  close: () => Promise<void>;
}> {
  const heard: string[] = [];
  const messages: string[] = [];
  const server: Server = createServer((socket: Socket) => {
    let stage = "command";
    let body = "";
    socket.setEncoding("utf8");
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      if (stage === "data") {
        body += chunk;
        const end = body.indexOf("\r\n.\r\n");
        if (end === -1) return;
        messages.push(body.slice(0, end));
        body = "";
        stage = "command";
        socket.write("250 queued\r\n");
        return;
      }
      for (const line of chunk.split("\r\n").filter((entry) => entry !== "")) {
        heard.push(line);
        const verb = line.split(" ")[0]?.toUpperCase();
        if (verb === "EHLO") {
          socket.write(`250-fake\r\n250-AUTH ${options.authMechanisms}\r\n250 SIZE 1024\r\n`);
        } else if (verb === "AUTH") {
          if (line.toUpperCase().startsWith("AUTH LOGIN")) socket.write("334 VXNlcm5hbWU6\r\n");
          else if (/^[A-Za-z0-9+/=]+$/.test(line)) {
            socket.write(
              heard.filter((e) => /^[A-Za-z0-9+/=]+$/.test(e)).length >= 2
                ? "235 ok\r\n"
                : "334 UGFzc3dvcmQ6\r\n",
            );
          } else socket.write("235 ok\r\n");
        } else if (verb === "MAIL" || verb === "RCPT" || verb === "QUIT") {
          socket.write("250 ok\r\n");
        } else if (verb === "DATA") {
          socket.write("354 go ahead\r\n");
          stage = "data";
        } else {
          socket.write("500 what\r\n");
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `smtp://someone:secret@127.0.0.1:${port}`,
        heard,
        messages,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe("smtp", () => {
  const open: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of open.splice(0)) await close();
  });

  it("authenticates, then delivers the message", async () => {
    const server = await fakeSmtp({ authMechanisms: "PLAIN LOGIN" });
    open.push(server.close);
    await sendSmtp(
      { url: server.url, from: "Suite <hello@suite.run>", requireTls: false },
      { to: "person@example.com", subject: "Confirm your address", text: "click this" },
    );
    // `QUIT` is written and the connection closed without waiting for the answer,
    // so the server sees it a turn later than the client returns.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(server.heard[0]).toBe("EHLO 127.0.0.1");
    expect(server.heard.some((line) => line.startsWith("AUTH PLAIN "))).toBe(true);
    expect(server.heard).toContain("MAIL FROM:<hello@suite.run>");
    expect(server.heard).toContain("RCPT TO:<person@example.com>");
    expect(server.heard).toContain("QUIT");
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain("To: person@example.com");
    expect(server.messages[0]).toContain("Subject: Confirm your address");
    expect(server.messages[0]).toContain("click this");
  });

  it("dot-stuffs a body line that begins with a dot", async () => {
    const server = await fakeSmtp({ authMechanisms: "PLAIN" });
    open.push(server.close);

    await sendSmtp(
      { url: server.url, from: "a@suite.run", requireTls: false },
      { to: "person@example.com", subject: "s", text: ".not a terminator" },
    );

    expect(server.messages[0]).toContain("\r\n\r\n..not a terminator");
  });

  it("refuses to continue when TLS is required and the server has none", async () => {
    const server = await fakeSmtp({ authMechanisms: "PLAIN" });
    open.push(server.close);

    await expect(
      sendSmtp(
        { url: server.url, from: "a@suite.run", requireTls: true },
        { to: "person@example.com", subject: "s", text: "t" },
      ),
    ).rejects.toThrow(/STARTTLS/);
    expect(server.messages).toHaveLength(0);
  });
});

describe("mailTransportFromEnv", () => {
  it("is the console transport when nothing is chosen", () => {
    const lines: string[] = [];
    expect(mailTransportFromEnv({}, { write: (line) => lines.push(line) })).toBeDefined();
  });

  it("refuses a vendor transport with no sender", () => {
    expect(() => mailTransportFromEnv({ SUITE_MAIL_TRANSPORT: "resend" })).toThrow(
      /SUITE_MAIL_FROM/,
    );
  });

  it("refuses resend with no key", () => {
    expect(() =>
      mailTransportFromEnv({ SUITE_MAIL_TRANSPORT: "resend", SUITE_MAIL_FROM: "a@b.c" }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it("refuses a name it does not know", () => {
    expect(() =>
      mailTransportFromEnv({ SUITE_MAIL_TRANSPORT: "sendmail", SUITE_MAIL_FROM: "a@b.c" }),
    ).toThrow(/not one of/);
  });
});
