import { describe, expect, it } from "vitest";
import {
  enrollmentOptions,
  enrollmentRedemption,
  type InvitationEmail,
  redemptionResult,
} from "./enrollment.js";
import { AuthError } from "./errors.js";
import { seatLicence } from "./seats.js";
import type { LicenceClaims, SeatLicence } from "./types.js";

/**
 * The two halves of our invitation surface: the plugin's options, and the wrapper that
 * turns its answers into ours
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §10–11).
 *
 * The mapping is tested here rather than only end to end because that is the guardrail:
 * a plugin release that renames `INVITE_EXPIRED` must not be able to turn an expired
 * invitation into a success, and an answer nobody recognises must fail closed.
 */
const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: 1,
    id: "lic-1",
    tier: "team",
    workspaces: 3,
    documentBytes: 1_000_000,
    attachmentBytes: 1_000_000,
    issuedAt: NOW - DAY,
    expiresAt: NOW + DAY,
    ...overrides,
  };
}

function licences(licence: SeatLicence | null) {
  return { forOrganization: async () => licence };
}

const ORG = { id: "org-agency", name: "Agency", slug: "agency" };

describe("the plugin's error codes become ours, or nothing", () => {
  it("reads an acceptance, with the organization the invitation granted", () => {
    expect(
      redemptionResult(200, {
        action: "ACCEPTED",
        organization: { id: "org-agency", name: "Agency", slug: "agency" },
        role: "member",
        signedIn: true,
      }),
    ).toEqual({ status: "redeemed", organizationId: "org-agency", role: "member", signedIn: true });
  });

  it("treats 'sign in first' as a deferral, not a redemption", () => {
    expect(redemptionResult(200, { action: "SIGN_IN_REQUIRED" })).toEqual({
      status: "sign-in-required",
    });
  });

  it.each([
    ["INVITE_NOT_FOUND", "invite-not-found"],
    ["INVITE_EXPIRED", "invite-expired"],
    ["INVITE_REVOKED", "invite-revoked"],
    ["INVITE_ALREADY_USED", "invite-exhausted"],
    ["INVITE_USES_EXHAUSTED", "invite-exhausted"],
    ["SEAT_LIMIT_REACHED", "seat-refused"],
    ["ORG_DISABLED", "forbidden"],
    ["USER_BANNED", "forbidden"],
    ["PASSWORD_REQUIRED", "invalid-request"],
  ] as const)("maps %s to %s", (code, expected) => {
    let thrown: unknown;
    try {
      redemptionResult(400, { code, message: "from the plugin" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuthError);
    expect((thrown as AuthError).code).toBe(expected);
    // The plugin's sentence is carried through, because it is the one a person reads.
    expect((thrown as AuthError).message).toBe("from the plugin");
  });

  it("turns a 429 into our own 'rate-limited', not into a generic refusal", () => {
    expect(() => redemptionResult(429, {})).toThrowError(
      expect.objectContaining({ code: "rate-limited" }),
    );
  });

  it("fails closed on a 4xx it does not recognise", () => {
    expect(() => redemptionResult(400, { code: "SOMETHING_NEW" })).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(() => redemptionResult(400, {})).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("fails closed on a 2xx it does not understand", () => {
    expect(() => redemptionResult(200, { action: "MAYBE" })).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(() => redemptionResult(200, {})).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("reports a plugin fault as an outage rather than as a refusal", () => {
    let thrown: unknown;
    try {
      redemptionResult(500, { code: "SEAT_LIMIT_REACHED" });
    } catch (error) {
      thrown = error;
    }
    // A 5xx is not a decision about this invitation: it is not an AuthError, so the
    // route answers 500 and an operator sees a failure.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(AuthError);
  });
});

describe("the redemption port", () => {
  interface Call {
    url: string;
    method: string;
    headers: Headers;
    body: Record<string, unknown>;
  }

  function port(answer: () => Response) {
    const calls: Call[] = [];
    const redeem = enrollmentRedemption({
      baseURL: "https://suite.example",
      handler: async (request) => {
        calls.push({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: (await request.json()) as Record<string, unknown>,
        });
        return answer();
      },
    });
    return { redeem, calls };
  }

  const accepted = () =>
    new Response(
      JSON.stringify({
        action: "ACCEPTED",
        organization: { id: "org-agency", name: "Agency", slug: "agency" },
        role: "member",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("calls the plugin's endpoint by URL, with no other header trusted", async () => {
    const { redeem, calls } = port(accepted);
    await redeem({ token: "t0ken", password: "correct horse battery" });
    expect(calls[0]).toMatchObject({
      url: "https://suite.example/api/auth/invite/redeem",
      method: "POST",
      body: { token: "t0ken", password: "correct horse battery" },
    });
    expect(calls[0]?.headers.get("origin")).toBe("https://suite.example");
    expect(calls[0]?.headers.get("cookie")).toBeNull();
  });

  it("forwards only the cookie, so a shareable link can see who is signed in", async () => {
    const { redeem, calls } = port(accepted);
    await redeem({
      token: "t0ken",
      headers: { cookie: "better-auth.session_token=abc", "x-forwarded-for": "10.0.0.1" },
    });
    expect(calls[0]?.headers.get("cookie")).toBe("better-auth.session_token=abc");
    expect(calls[0]?.headers.get("x-forwarded-for")).toBeNull();
  });

  it("answers with our outcome on success", async () => {
    const { redeem } = port(accepted);
    await expect(redeem({ token: "t0ken" })).resolves.toEqual({
      status: "redeemed",
      organizationId: "org-agency",
      role: "member",
      signedIn: false,
    });
  });

  it("answers with our code on refusal", async () => {
    const { redeem } = port(
      () =>
        new Response(JSON.stringify({ code: "INVITE_EXPIRED", message: "gone" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(redeem({ token: "t0ken" })).rejects.toMatchObject({ code: "invite-expired" });
  });

  it("fails closed when the engine answers something that is not JSON", async () => {
    const { redeem } = port(() => new Response("<html>gateway</html>", { status: 400 }));
    await expect(redeem({ token: "t0ken" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("the plugin's options", () => {
  it("keeps self-serve sign-up closed while the passwordless doors stay open", () => {
    const options = enrollmentOptions({ licences: licences(null), now: () => NOW });
    // "invite-only" is what makes a private invite set a password; the open-signup
    // flag is what stops that guarantee becoming an app-wide closure, which would
    // contradict §7 (registration is open, admission is reviewed).
    expect(options.mode).toBe("invite-only");
    expect(options.allowOpenSignup).toBe(true);
    // Passwordless redemption is the *other* flow: a private invite that sets no
    // password. It is off, because a password is what an invited account may set.
    expect(options.passwordless).toBe(false);
    expect(options.hashTokens).toBe(true);
    expect(options.autoVerifyPublicInviteEmail).toBe(false);
    expect(options.organization?.allowOwnerInvites).toBe(false);
    expect(options.organization?.defaultOrganizationRole).toBe("member");
  });

  it("reads the seat limit from the licence, and fails closed without one", async () => {
    const withSeats = enrollmentOptions({
      licences: licences(seatLicence(claims(), 5)),
      now: () => NOW,
    });
    await expect(withSeats.organization?.resolveSeatLimit?.(ORG)).resolves.toBe(5);

    const noLicence = enrollmentOptions({ licences: licences(null), now: () => NOW });
    await expect(noLicence.organization?.resolveSeatLimit?.(ORG)).resolves.toBe(0);

    const expired = enrollmentOptions({
      licences: licences(seatLicence(claims({ expiresAt: NOW - 1 }), 5)),
      now: () => NOW,
    });
    await expect(expired.organization?.resolveSeatLimit?.(ORG)).resolves.toBe(0);
  });

  it("refuses to create a private invitation it cannot deliver", async () => {
    const options = enrollmentOptions({ licences: licences(null), now: () => NOW });
    await expect(
      options.sendPrivateInvitation?.(
        {
          email: "nobody@example.com",
          name: null,
          role: "user",
          kind: "org-join",
          mode: "invite-only",
          url: "https://suite.example/invite?token=t0ken",
          token: "t0ken",
          inviterName: "Owner",
          inviterEmail: "owner@example.com",
          organizationName: "Agency",
          inviteId: "invite-1",
          organizationId: "org-agency",
          organizationRole: "member",
          teamId: null,
          expiresAt: new Date(NOW + DAY),
        },
        undefined,
      ),
    ).rejects.toThrow(/invitation sender/u);
  });

  it("hands the sender milliseconds, the unit this service uses everywhere", async () => {
    const sent: InvitationEmail[] = [];
    const options = enrollmentOptions({
      licences: licences(null),
      now: () => NOW,
      sendInvitation: async (invitation) => {
        sent.push(invitation);
      },
    });
    await options.sendPrivateInvitation?.(
      {
        email: "colleague@example.com",
        name: "Colleague",
        role: "user",
        kind: "org-join",
        mode: "invite-only",
        url: "https://suite.example/invite?token=t0ken",
        token: "t0ken",
        inviterName: "Owner",
        inviterEmail: "owner@example.com",
        organizationName: "Agency",
        inviteId: "invite-1",
        organizationId: "org-agency",
        organizationRole: "member",
        teamId: null,
        expiresAt: new Date(NOW + DAY),
      },
      undefined,
    );
    expect(sent).toEqual([
      {
        email: "colleague@example.com",
        name: "Colleague",
        url: "https://suite.example/invite?token=t0ken",
        token: "t0ken",
        organizationName: "Agency",
        organizationRole: "member",
        inviteId: "invite-1",
        inviterName: "Owner",
        inviterEmail: "owner@example.com",
        expiresAt: NOW + DAY,
      },
    ]);
  });
});
