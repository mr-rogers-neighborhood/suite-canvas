import { describe, expect, it } from "vitest";
import { hashWorkspaceId, leaksCredential, scrubEvent } from "./scrub";

/** A session JWT, the credential a crash report must never carry (ADR-0074). */
const CREDENTIAL =
  "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDMzMDB9.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

/** A Sentry-shaped event carrying exactly the material a report must not send. */
function richEvent() {
  return {
    event_id: "abc123",
    timestamp: 1_700_000_000,
    level: "error",
    message: "Card “Quarterly numbers” failed",
    transaction: "/?workspace=ws-1&share=sekret",
    user: { id: "person-1", email: "someone@example.com" },
    tags: { credential: CREDENTIAL },
    extra: {
      cardTitle: "Quarterly numbers",
      cardBody: "Revenue was 42",
      attachmentName: "payslip.pdf",
      shareToken: "share-token-abc",
      credential: CREDENTIAL,
    },
    contexts: {
      browser: { name: "Chrome", version: "120.0" },
      os: { name: "Linux" },
      device: { name: "secret device" },
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: `failed for card ${CREDENTIAL}`,
          stacktrace: {
            frames: [
              { filename: "app.js", function: "render", lineno: 10, colno: 3, in_app: true },
              { filename: "vendor.js", function: "flush", lineno: 99, colno: 1, in_app: false },
            ],
          },
        },
      ],
    },
    breadcrumbs: [{ message: "typed into card Quarterly numbers" }],
  };
}

describe("crash payload scrubbing", () => {
  it("keeps only the allowlisted fields", () => {
    const payload = scrubEvent(richEvent(), {
      buildVersion: "0.2.0-alpha.1",
      mode: "production",
      route: "/?workspace=ws-1",
      workspaceHash: "f".repeat(16),
      credential: CREDENTIAL,
    });

    expect(payload).not.toBeNull();
    const text = JSON.stringify(payload);
    // Allowed.
    expect(payload?.release).toBe("0.2.0-alpha.1");
    expect(payload?.transaction).toBe("/?workspace=ws-1");
    expect(text).toContain("Chrome");
    expect(text).toContain("render");
    expect(payload?.workspace).toEqual({ id_hash: "f".repeat(16) });
    // Forbidden: card text, attachments, tokens, the credential, device, user.
    for (const secret of [
      "Quarterly numbers",
      "Revenue was 42",
      "payslip.pdf",
      "share-token-abc",
      CREDENTIAL,
      "someone@example.com",
      "secret device",
      "typed into card",
      "sekret",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("never sends the credential beside the hashed workspace id", () => {
    const payload = scrubEvent(richEvent(), {
      buildVersion: "0.2.0-alpha.1",
      mode: "production",
      route: "/",
      workspaceHash: "abcdef0123456789",
      credential: CREDENTIAL,
    });

    // The event mentions the token in `tags`/`extra`/the exception message; the
    // allowlist drops those paths, so the payload is clean.
    expect(payload).not.toBeNull();
    expect(leaksCredential(payload, CREDENTIAL)).toBe(false);
  });

  it("drops the event outright when the credential cannot be removed", () => {
    // A stack frame is copied verbatim, so this is the one path that could carry
    // free text through the allowlist. The guard must refuse the payload.
    const event = richEvent();
    const frame = `${CREDENTIAL} appeared in a frame`;
    const firstFrame = event.exception.values[0]?.stacktrace.frames[0] as
      | { function: string }
      | undefined;
    if (!firstFrame) throw new Error("the fixture lost its frames");
    firstFrame.function = frame;

    expect(
      scrubEvent(event, {
        buildVersion: "dev",
        mode: "development",
        route: "/",
        workspaceHash: "abcdef0123456789",
        credential: CREDENTIAL,
      }),
    ).toBeNull();
  });

  it("omits the workspace hash when hashing is unavailable", () => {
    const payload = scrubEvent(richEvent(), {
      buildVersion: "dev",
      mode: "development",
      route: "/",
      workspaceHash: null,
      credential: null,
    });
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty("workspace");
  });

  it("hashes the workspace id instead of sending it", async () => {
    const hash = await hashWorkspaceId("ws-secret-room");
    if (hash === null) return; // A runtime without WebCrypto cannot hash; skip.
    expect(hash).toHaveLength(16);
    expect(hash).not.toContain("ws-secret-room");
    expect(await hashWorkspaceId("ws-secret-room")).toBe(hash);
    expect(await hashWorkspaceId("another-room")).not.toBe(hash);
  });
});
