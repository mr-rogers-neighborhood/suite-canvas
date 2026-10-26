import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Logger } from "../handler/log.ts";
import {
  consoleEmailer,
  emailerFromEnvironment,
  renderLicenceEmail,
  SES_MODULE,
  sesEmailer,
} from "./email.ts";
import { NOW } from "./testing.ts";

const TOKEN = "eyJ2IjoxLCJpZCI6ImxpYy0xIn0.c2lnbmF0dXJl";

function input(overrides: Partial<Parameters<typeof renderLicenceEmail>[0]> = {}) {
  return {
    to: "buyer@example.com",
    token: TOKEN,
    workspaces: 3,
    expiresAt: NOW,
    licenceId: "lic-abc",
    selfHostUrl: "https://example.com/self-host",
    renewal: false,
    ...overrides,
  };
}

function recordingLogger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const log: Logger = (level, message, fields) => {
    lines.push(JSON.stringify({ level, message, ...fields }));
  };
  return { log, lines };
}

describe("renderLicenceEmail", () => {
  it("carries the token, one line on what it unlocks, and the self-host path", () => {
    const message = renderLicenceEmail(input());
    assert.equal(message.to, "buyer@example.com");
    assert.equal(message.subject, "Your Suite hosted-sync licence");
    assert.ok(message.text.includes(TOKEN), "the token must be in the body");
    assert.ok(
      message.text.includes(
        "What it unlocks: the hosted relay (sync across your devices, share links and live collaboration) for 3 workspaces until 2027-01-15.",
      ),
      "one plain sentence describing what was bought",
    );
    assert.ok(message.text.includes("free and open source"));
    assert.ok(message.text.includes("Self-host it: https://example.com/self-host"));
    assert.ok(message.text.includes("lic-abc"));
  });

  it("speaks about renewal when the licence was renewed", () => {
    const message = renderLicenceEmail(input({ renewal: true, workspaces: 1 }));
    assert.equal(message.subject, "Your Suite hosted-sync licence has renewed");
    assert.ok(message.text.startsWith("Your hosted sync renewed."));
    assert.ok(message.text.includes("1 workspace until"));
  });
});

describe("consoleEmailer", () => {
  it("logs the delivery but never the token", async () => {
    const { log, lines } = recordingLogger();
    await consoleEmailer({ log }).send(renderLicenceEmail(input()));
    assert.equal(lines.length, 1);
    assert.ok(lines[0]?.includes("console transport"));
    assert.ok(!lines.join("\n").includes(TOKEN), "a console log must not carry a live token");
  });

  it("prints the body only when explicitly asked", async () => {
    const { log, lines } = recordingLogger();
    await consoleEmailer({ log, includeBody: true }).send(renderLicenceEmail(input()));
    assert.equal(lines.length, 2);
    assert.ok(lines[1]?.includes(TOKEN));
  });
});

describe("sesEmailer", () => {
  function fakeSes() {
    const sent: unknown[] = [];
    const configs: unknown[] = [];
    class SESClient {
      constructor(config: unknown) {
        configs.push(config);
      }
      async send(command: unknown): Promise<unknown> {
        sent.push(command);
        return {};
      }
    }
    class SendEmailCommand {
      readonly input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    }
    return { sdk: { SESClient, SendEmailCommand }, sent, configs };
  }

  it("sends the rendered message through SES", async () => {
    const { sdk, sent, configs } = fakeSes();
    const emailer = await sesEmailer({
      from: "licences@example.com",
      region: "eu-west-1",
      loadSdk: async () => sdk,
      log: recordingLogger().log,
    });
    await emailer.send(renderLicenceEmail(input()));

    assert.deepEqual(configs, [{ region: "eu-west-1" }]);
    const command = sent[0] as { input: unknown } | undefined;
    assert.ok(command !== undefined);
    assert.deepEqual(command.input, {
      Source: "licences@example.com",
      Destination: { ToAddresses: ["buyer@example.com"] },
      Message: {
        Subject: { Data: "Your Suite hosted-sync licence", Charset: "UTF-8" },
        Body: { Text: { Data: renderLicenceEmail(input()).text, Charset: "UTF-8" } },
      },
    });
  });

  it("explains how to install the SDK when it is missing", async () => {
    await assert.rejects(
      sesEmailer({
        from: "licences@example.com",
        loadSdk: async () => {
          throw new Error("Cannot find package");
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(SES_MODULE) &&
        error.message.includes("services/billing"),
    );
  });
});

describe("emailerFromEnvironment", () => {
  it("falls back to the console with a warning when no address is set", async () => {
    const { log, lines } = recordingLogger();
    const emailer = await emailerFromEnvironment(undefined, undefined, log);
    await emailer.send(renderLicenceEmail(input()));
    assert.ok(lines[0]?.includes("SES_FROM_ADDRESS is not set"));
    assert.ok(!lines.join("\n").includes(TOKEN));
  });

  it("needs the SDK once an address is configured", async () => {
    await assert.rejects(
      emailerFromEnvironment("licences@example.com", "eu-west-1", recordingLogger().log),
      (error: unknown) => error instanceof Error && error.message.includes(SES_MODULE),
    );
  });
});
