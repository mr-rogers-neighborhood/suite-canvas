import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createAuthEntry } from "./entry.js";
import { authEnvironment } from "./env.js";
import { databaseUrlProblem } from "./postgres.js";
import { seatLicence } from "./seats.js";
import type { LicenceClaims } from "./types.js";

/**
 * The deployment seam ([ADR-0065](../../../docs/decisions/0065-accounts-own-workspaces.md) §9).
 *
 * Nothing here connects to a database. What is worth pinning is the *refusal*: a
 * deployment that is switched on with a broken URL must say so at start-up rather
 * than fail inside a sign-in, because the failure mode of the latter is a session
 * that silently does not exist — and the relay would then treat an account request
 * as anonymous.
 */

const BASE_URL = "https://suite.example";
const NOW = 1_760_000_000_000;

function claims(): LicenceClaims {
  return {
    v: 1,
    id: "lic-1",
    tier: "team",
    workspaces: 3,
    documentBytes: 1_000_000,
    attachmentBytes: 1_000_000,
    issuedAt: NOW - 1000,
    expiresAt: NOW + 1000,
  };
}

function deps() {
  return {
    licences: { forOrganization: async () => seatLicence(claims(), 5) },
    memberships: {
      countForOrganization: async () => 0,
      countForUser: async () => 0,
      roleFor: async () => null,
      listForOrganization: async () => [],
    },
    sendMagicLink: async () => {},
  };
}

const configured = (overrides: Record<string, string | undefined> = {}) =>
  authEnvironment({
    SUITE_AUTH_ENABLED: "1",
    SUITE_AUTH_SECRET: "t".repeat(40),
    SUITE_AUTH_URL: BASE_URL,
    SUITE_AUTH_DATABASE_URL: "postgres://user:pass@db.example:5432/suite",
    SUITE_AUTH_RP_ID: "suite.example",
    SUITE_AUTH_RP_NAME: "Suite",
    ...overrides,
  });

describe("the database URL check", () => {
  it("accepts the two postgres spellings and nothing else", () => {
    expect(databaseUrlProblem("postgres://u:p@h:5432/db")).toBeNull();
    expect(databaseUrlProblem("postgresql://u:p@h/db")).toBeNull();
    // Whitespace from a copied env var is not a configuration error.
    expect(databaseUrlProblem("  postgres://u@h/db  ")).toBeNull();
  });

  it("names what is wrong, so an operator can fix it without a stack trace", () => {
    expect(databaseUrlProblem(undefined)).toBe("is not set");
    expect(databaseUrlProblem("")).toBe("is not set");
    expect(databaseUrlProblem("not a url")).toBe("is not a URL");
    expect(databaseUrlProblem("mysql://u@h/db")).toBe("must be a postgres:// URL, not mysql://");
  });
});

describe("the auth entry", () => {
  it("refuses to compose while the service is switched off", () => {
    // Closed by default: a session that cannot be verified is worse than an
    // obvious outage, because the relay would treat it as anonymous.
    expect(() =>
      createAuthEntry(configured({ SUITE_AUTH_ENABLED: "0" }), {
        ...deps(),
        database: memoryAdapter(Object.fromEntries([])),
      }),
    ).toThrowError(/SUITE_AUTH_ENABLED/);
  });

  it("refuses a switched-on deployment whose database URL is unusable", () => {
    expect(() =>
      createAuthEntry(configured({ SUITE_AUTH_DATABASE_URL: "mysql://u@h/db" }), deps()),
    ).toThrowError(/SUITE_AUTH_DATABASE_URL must be a postgres/);
  });

  it("composes a handler when it is configured, and closes what it opened", async () => {
    let closed = false;
    const entry = createAuthEntry(configured(), {
      ...deps(),
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        organization: [],
        member: [],
        invitation: [],
        passkey: [],
        twoFactor: [],
      }),
      close: async () => {
        closed = true;
      },
    });

    // The seam is a real Better Auth handler: an unauthenticated session read is a
    // 200 with null, which proves the composition rather than the config.
    const response = await entry.handler(
      new Request(`${BASE_URL}/api/auth/get-session`, { headers: { origin: BASE_URL } }),
    );
    expect(response.status).toBe(200);

    await entry.close();
    expect(closed).toBe(true);
  });
});
