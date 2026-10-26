import { getAuthTables } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { authOptions } from "./betterAuth.js";
import { authEnvironment } from "./env.js";
import { seatLicence } from "./seats.js";
import type { LicenceClaims } from "./types.js";

/**
 * What the plugins actually contribute to the schema
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md), [ADR-0068](../../../docs/decisions/0068-a-system-workspace-authors-what-workspaces-start-with.md) §7).
 *
 * Importing a plugin proves nothing — a plugin can be registered and still not add
 * the field a feature reads. This asks Better Auth itself for the tables the
 * configured instance produces, so a plugin that silently stops contributing (a
 * version bump, a renamed option) fails here instead of in production.
 *
 * It also protects the migration: `sql/0002_plugins.sql` and `sql/0005_enrollment.sql`
 * are written by hand, so the columns they declare are asserted against this output
 * rather than against memory.
 */

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

function tables(): ReturnType<typeof getAuthTables> {
  return getAuthTables(options());
}

/** The `user` table's field names, or a failure that names the missing table. */
function options() {
  return authOptions({
    env: authEnvironment({
      SUITE_AUTH_ENABLED: "1",
      SUITE_AUTH_SECRET: "t".repeat(40),
      SUITE_AUTH_URL: "https://suite.example",
      SUITE_AUTH_DATABASE_URL: "postgres://u@h/db",
    }),
    // The hooks read these; table introspection never calls them.
    database: () => {
      throw new Error("introspection must not touch the database");
    },
    licences: { forOrganization: async () => seatLicence(claims(), 5) },
    memberships: {
      countForOrganization: async () => 0,
      countForUser: async () => 0,
      roleFor: async () => null,
      listForOrganization: async () => [],
    },
    sendMagicLink: async () => {},
    now: () => NOW,
  });
}

function userFields(): string[] {
  const user = tables().user;
  if (user === undefined) throw new Error("the schema has no user table");
  return Object.keys(user.fields);
}

function sessionOf() {
  const session = tables().session;
  if (session === undefined) throw new Error("the schema has no session table");
  return session;
}

describe("the schema the plugins produce", () => {
  it("carries our admission stamp, which is ours and not a plugin's", () => {
    expect(userFields()).toContain("admittedAt");
  });

  it("carries normalization, so one person cannot become two seats", () => {
    expect(userFields()).toContain("normalizedEmail");
  });

  it("carries the admin, two-factor and last-login fields", () => {
    const user = userFields();
    // admin
    expect(user).toContain("role");
    expect(user).toContain("banned");
    expect(user).toContain("banReason");
    expect(user).toContain("banExpires");
    // twoFactor
    expect(user).toContain("twoFactorEnabled");
    // anonymous — the field that marks a session as claimable rather than owned
    expect(user).toContain("isAnonymous");
    // `lastLoginMethod` deliberately adds *no* column: it remembers the method in a
    // cookie, so the sign-in screen can offer it without us storing login history
    // server-side. Asserted as an absence, because adding a column later would be a
    // privacy decision rather than a schema detail.
    expect(user).not.toContain("lastLoginMethod");
  });

  it("has the tables those plugins write to", () => {
    const names = Object.keys(tables());
    expect(names).toContain("twoFactor");
    // The organization plugin's invitation is the email-bound path ADR-0067 keeps.
    expect(names).toContain("invitation");
    expect(names).toContain("member");
    expect(names).toContain("passkey");
  });

  it("carries the invitation engine's own tables, by the names the migration creates", () => {
    const names = Object.keys(tables());
    // `sql/0005_enrollment.sql` creates exactly these two. A plugin release that
    // renamed a model would otherwise fail at runtime, in production, on the first
    // invitation.
    expect(names).toContain("invite");
    expect(names).toContain("inviteUse");
    const invite = tables().invite;
    if (invite === undefined) throw new Error("the invite table is missing");
    expect(Object.keys(invite.fields)).toEqual(
      expect.arrayContaining(["tokenHash", "status", "organizationId", "useCount", "expiresAt"]),
    );
    const use = tables().inviteUse;
    if (use === undefined) throw new Error("the inviteUse table is missing");
    expect(Object.keys(use.fields)).toEqual(
      expect.arrayContaining(["inviteId", "usedByUserId", "inviteeEmail", "usedAt"]),
    );
    // The seat limit the plugin reads back is a column on `organization`, so the
    // migration has to add it.
    const organization = tables().organization;
    if (organization === undefined) throw new Error("the organization table is missing");
    expect(Object.keys(organization.fields)).toEqual(
      expect.arrayContaining(["seatLimit", "disabledAt"]),
    );
  });

  it("keeps self-serve password sign-up closed, and throttles the route that is not", () => {
    const configured = options();
    // The pair is the security property, not a preference: enabled turns the door on
    // for invited accounts, disableSignUp keeps the sign-up form shut (ADR-0067 §11).
    expect(configured.emailAndPassword).toMatchObject({ enabled: true, disableSignUp: true });
    expect(configured.rateLimit?.customRules).toHaveProperty("/sign-in/email");
  });

  it("records impersonation on the session, so an operator's action is attributable", () => {
    expect(Object.keys(sessionOf().fields)).toContain("impersonatedBy");
  });
});
