import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { authEnvironment } from "../http/env.js";
import type { InvitationEmail } from "../invitations/enrollment.js";
import type { EntitlementReader } from "../licensing/entitlements.js";
import type { MembershipReader } from "../licensing/licences.js";
import type { OrganizationInvitation } from "../mail/mail.js";
import { seatLicence } from "../organizations/seats.js";
import type { LicenceClaims, SeatLicence } from "../types.js";
import {
  type AuthInstance,
  type AuthServiceDeps,
  authOptions,
  createAuthService,
  sessionReader,
} from "./betterAuth.js";
import { RELAY_TOKEN_TTL_SECONDS } from "./relayToken.js";

/**
 * Better Auth is really installed, really constructed, and really exercised
 * here — organization plugin, magic link and passkey all registered — but on
 * Better Auth's own in-memory adapter rather than Postgres.
 *
 * That is the honest test of this lane: the policy (seats, tenant ceiling, role
 * resolution) is ours and runs through the plugin's real hooks, while the
 * database underneath is a seam. What it does *not* prove is the Postgres
 * adapter; README.md says so plainly.
 */
const BASE_URL = "https://suite.example";
const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const modelNames = [
  "user",
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
  "passkey",
  // `twoFactor` is the only table `twoFactor` adds; admin adds fields to
  // `user`/`session`, last-login-method adds a field, captcha adds none.
  "twoFactor",
  // `better-enrollment`: the invitation row and its append-only use log.
  "invite",
  "inviteUse",
  // `jwt`: the signing key pair the relay verifies against.
  "jwks",
] as const;

type Store = Record<string, unknown[]>;

interface StoredMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date | string;
}

/**
 * The membership reader the hooks and the session reader use, backed by the same
 * rows the plugin writes. In production this is SQL against Better Auth's
 * `member` table; here it is the adapter's own array — the point is that both
 * read *one* source, so a hook sees the member the plugin just inserted.
 */
function storeMemberships(store: Store): MembershipReader {
  const rows = (): StoredMember[] => (store.member ?? []) as StoredMember[];
  const roleOf = (value: string): "owner" | "admin" | "member" | null =>
    value === "owner" || value === "admin" || value === "member" ? value : null;
  return {
    countForOrganization: async (organizationId) =>
      rows().filter((row) => row.organizationId === organizationId).length,
    countForUser: async (userId) => rows().filter((row) => row.userId === userId).length,
    roleFor: async (organizationId, userId) => {
      const row = rows().find(
        (member) => member.organizationId === organizationId && member.userId === userId,
      );
      return row === undefined ? null : roleOf(row.role);
    },
    listForOrganization: async (organizationId) =>
      rows()
        .filter((row) => row.organizationId === organizationId)
        .map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          userId: row.userId,
          role: roleOf(row.role) ?? "member",
          createdAt: new Date(row.createdAt).getTime(),
        })),
  };
}

interface TestAuth extends AuthInstance {
  api: AuthInstance["api"] & {
    signInMagicLink: (input: { body: { email: string }; headers: Headers }) => Promise<unknown>;
    createOrganization: (input: {
      body: { name: string; slug: string };
      headers: Headers;
    }) => Promise<{ id: string; slug: string } | null>;
    addMember: (input: {
      body: { userId: string; role: string; organizationId: string };
      headers: Headers;
    }) => Promise<unknown>;
    signUpEmail: (input: {
      body: { email: string; password: string; name: string };
      headers?: Headers;
    }) => Promise<unknown>;
    signInEmail: (input: {
      body: { email: string; password: string };
      headers: Headers;
    }) => Promise<{ user: { id: string; email: string } }>;
    createInvite: (input: {
      body: {
        type?: "private" | "public";
        kind?: "app" | "org-join";
        email?: string;
        organizationId?: string;
        organizationRole?: string;
        maxUses?: number;
        expiresIn?: number;
      };
      headers: Headers;
    }) => Promise<{ inviteId: string; token?: string; url?: string }>;
  };
  options: { socialProviders?: Record<string, unknown> };
}

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: 1,
    id: "lic-1",
    tier: "team",
    workspaces: 5,
    documentBytes: 1_000_000,
    attachmentBytes: 1_000_000,
    issuedAt: NOW - DAY,
    expiresAt: NOW + DAY,
    ...overrides,
  };
}

interface Harness {
  auth: TestAuth;
  store: Store;
  /** Change the licence the hooks read, as an operator would. */
  setLicence: (value: SeatLicence | null) => void;
  signIn: (email: string) => Promise<{ cookie: string; userId: string }>;
  addUser: (email: string) => string;
  /** Stamp a user as admitted, the way the admin panel's queue does. */
  admit: (userId: string) => void;
  /** Private invitations handed to the sender, in order. */
  invitations: InvitationEmail[];
  /** The magic link the plugin asked us to deliver, if any. */
  lastLink: () => string | null;
  /** The verification link the plugin asked us to deliver, if any. */
  lastVerification: () => string | null;
  /** Addresses a verification message was addressed to, in order. */
  verified: string[];
  /** Organization invitations handed to the sender, in order. */
  organizationInvitations: OrganizationInvitation[];
}

/** The environment every harness in this file shares, with a knob per test. */
function environment(
  options: { maxOrganizations?: number; admission?: boolean } = {},
): ReturnType<typeof authEnvironment> {
  return authEnvironment({
    SUITE_AUTH_ENABLED: "1",
    SUITE_AUTH_SECRET: "t".repeat(40),
    SUITE_AUTH_URL: BASE_URL,
    SUITE_AUTH_DATABASE_URL: "postgres://unused/test",
    SUITE_GOOGLE_CLIENT_ID: "google-id",
    SUITE_GOOGLE_CLIENT_SECRET: "google-secret",
    SUITE_AUTH_RP_ID: "suite.example",
    SUITE_AUTH_RP_NAME: "Suite",
    SUITE_AUTH_MAX_ORGS_PER_USER: String(options.maxOrganizations ?? 1),
    ...(options.admission === true ? { SUITE_ADMISSION_REQUIRED: "1" } : {}),
  });
}

/** Dependencies for the tests that inspect the options rather than drive the API. */
function serviceDeps(): AuthServiceDeps {
  return {
    env: environment(),
    database: memoryAdapter(Object.fromEntries(modelNames.map((name) => [name, []]))),
    licences: { forOrganization: async () => null },
    memberships: {
      countForOrganization: async () => 0,
      countForUser: async () => 0,
      roleFor: async () => null,
      listForOrganization: async () => [],
    },
    sendMagicLink: async () => {},
    sendVerificationEmail: async () => {},
    sendOrganizationInvitation: async () => {},
    now: () => NOW,
  };
}

function harness(
  options: {
    seats?: number;
    maxOrganizations?: number;
    admission?: boolean;
    entitlements?: EntitlementReader;
  } = {},
): Harness {
  const store: Store = Object.fromEntries(modelNames.map((name) => [name, []]));
  const memberships = storeMemberships(store);
  let licence: SeatLicence | null = seatLicence(claims(), options.seats ?? 5);
  let link: string | null = null;
  let verification: string | null = null;
  const verified: string[] = [];
  const invitations: InvitationEmail[] = [];
  const organizationInvitations: OrganizationInvitation[] = [];

  const auth = createAuthService({
    env: environment(options),
    database: memoryAdapter(store),
    licences: { forOrganization: async () => licence },
    memberships,
    ...(options.entitlements === undefined ? {} : { entitlements: options.entitlements }),
    sendMagicLink: async ({ url }) => {
      link = url;
    },
    sendVerificationEmail: async ({ email, url }) => {
      verification = url;
      verified.push(email);
    },
    sendOrganizationInvitation: async (invitation) => {
      organizationInvitations.push(invitation);
    },
    sendInvitation: async (invitation) => {
      invitations.push(invitation);
    },
    now: () => NOW,
  }) as unknown as TestAuth;

  const reader = sessionReader(auth, memberships);

  const signIn = async (email: string) => {
    await auth.api.signInMagicLink({ body: { email }, headers: new Headers({ origin: BASE_URL }) });
    if (link === null) throw new Error("the plugin never asked for a magic link");
    const response = await auth.handler(new Request(link, { redirect: "manual" }));
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (cookie.length === 0) throw new Error("no session cookie came back");
    const session = await reader.sessionFor({ cookie });
    if (session === null) throw new Error("the cookie did not resolve to a session");
    return { cookie, userId: session.userId };
  };

  // A second account, created the way Better Auth creates one (a magic-link
  // sign-in) so the id is real and the row is not hand-written.
  const addUser = (email: string): string => {
    const user = {
      id: `user-${email.length}-${Math.random().toString(36).slice(2, 10)}`,
      email,
      name: email,
      emailVerified: true,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    };
    store.user?.push(user);
    store.account?.push({
      id: `account-${user.id}`,
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    });
    return user.id;
  };

  return {
    auth,
    store,
    setLicence: (value) => {
      licence = value;
    },
    signIn,
    admit: (userId) => {
      const row = (store.user ?? []).find((entry) => (entry as { id?: string }).id === userId) as
        | { admittedAt?: number }
        | undefined;
      if (row === undefined) throw new Error(`${userId} is not a stored user`);
      row.admittedAt = NOW;
    },
    invitations,
    lastLink: () => link,
    lastVerification: () => verification,
    verified,
    organizationInvitations,
    addUser,
  };
}

describe("the Better Auth surface", () => {
  it("registers magic link, passkeys and Google", () => {
    const { auth } = harness();
    // The plugins are wired, not described: Better Auth only exposes a route when
    // its plugin is installed, and the provider only exists when configured.
    expect(typeof auth.api.signInMagicLink).toBe("function");
    expect(auth.options.socialProviders).toHaveProperty("google");
  });

  it("signs a person in with a magic link and no organization yet", async () => {
    const { auth, signIn, store } = harness();
    const { cookie, userId } = await signIn("owner@example.com");
    const session = await sessionReader(auth, storeMemberships(store)).sessionFor({ cookie });
    // Signed in, unadmitted: the session says so rather than hiding it, so a route
    // can answer "you are on the list" instead of "forbidden".
    expect(session).toEqual({
      userId,
      organizationId: null,
      role: null,
      admittedAt: null,
      mfaRequired: false,
    });
  });

  it("returns no session for a cookie it did not issue", async () => {
    const { auth, store } = harness();
    const reader = sessionReader(auth, storeMemberships(store));
    expect(await reader.sessionFor({ cookie: "better-auth.session_token=forged" })).toBeNull();
    expect(await reader.sessionFor({})).toBeNull();
  });
});

describe("the relay token", () => {
  /** A JWT payload, decoded without verifying: the signature is the key set's job. */
  function payloadOf(token: string): Record<string, unknown> {
    const segment = token.split(".")[1];
    if (segment === undefined) throw new Error("the token has no payload segment");
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  }

  it("mints a token carrying sub, org, role, tier and limits", async () => {
    const { auth, signIn } = harness();
    const { cookie, userId } = await signIn("member@example.com");
    const organization = await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/token`, { headers: { cookie } }),
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const claims = payloadOf(token);

    expect(claims).toMatchObject({
      sub: userId,
      org: organization?.id,
      // The creator of the organization is its owner, read from the member row.
      role: "owner",
      // Nothing has been bought, so the injected default answers for everyone.
      tier: "free",
      limits: {},
    });
    // The TTL is the revocation window, and it is five minutes.
    expect(Number(claims.exp) - Number(claims.iat)).toBe(RELAY_TOKEN_TTL_SECONDS);
  });

  it("takes tier and limits from the injected entitlement reader", async () => {
    const { auth, signIn } = harness({
      entitlements: {
        forOrganization: async () => ({ tier: "team", limits: { workspaces: 10 } }),
      },
    });
    const { cookie } = await signIn("member@example.com");
    await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/token`, { headers: { cookie } }),
    );
    const { token } = (await response.json()) as { token: string };
    // The billing lane's reader is org-keyed, so wiring it needs no adapter: the same
    // `forOrganization` shape arrives here and its numbers land in the claim.
    expect(payloadOf(token)).toMatchObject({
      tier: "team",
      limits: { workspaces: 10 },
    });
  });

  it("publishes the key set the relay verifies against", async () => {
    const { auth, signIn } = harness();
    const { cookie } = await signIn("member@example.com");
    // Minting is what materialises the key pair; the endpoint answers from the table.
    await auth.handler(new Request(`${BASE_URL}/api/auth/token`, { headers: { cookie } }));

    const response = await auth.handler(new Request(`${BASE_URL}/api/auth/jwks`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys?: Array<Record<string, unknown>> };
    expect(body.keys?.length).toBeGreaterThan(0);
    expect(body.keys?.[0]).toMatchObject({ kty: "OKP", alg: "EdDSA" });
    // A public key set: the private half never leaves the control plane.
    expect(body.keys?.[0]).not.toHaveProperty("d");
  });

  it("adds the billing plugin when one is supplied, and nothing when it is not", async () => {
    const plugin = { id: "test-billing", version: "0.0.0", endpoints: {} } as never;
    const withBilling = authOptions({
      ...serviceDeps(),
      billingPlugin: plugin,
    });
    const without = authOptions(serviceDeps());

    const ids = (options: ReturnType<typeof authOptions>): unknown[] =>
      (options.plugins ?? []).map((entry) => (entry as { id?: unknown }).id);
    expect(ids(withBilling)).toContain("test-billing");
    expect(ids(without)).not.toContain("test-billing");
  });
});

describe("organization policy through the plugin's hooks", () => {
  it("makes the creator the owner and reports that role on the session", async () => {
    const { auth, signIn, store } = harness();
    const { cookie } = await signIn("owner@example.com");

    const organization = await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });

    expect(organization?.slug).toBe("agency");
    const session = await sessionReader(auth, storeMemberships(store)).sessionFor({ cookie });
    expect(session?.organizationId).toBe(organization?.id);
    expect(session?.role).toBe("owner");
  });

  it("refuses a second member when the licence holds one seat", async () => {
    const { auth, signIn, addUser } = harness({ seats: 1 });
    const { cookie } = await signIn("owner@example.com");
    const organization = await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });
    const second = addUser("tester@example.com");

    // The refusal reads as a sentence now: `seatProblemMessage` is the one place that
    // turns a seat refusal into words, so the person refused reads "this organization
    // has more members than its licence allows" instead of the enum name. The machine
    // reason travels in `body.reason`, which is what a client acts on.
    const thrown: unknown = await auth.api
      .addMember({
        body: { userId: second, role: "member", organizationId: organization?.id ?? "" },
        headers: new Headers({ cookie }),
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(thrown).toMatchObject({
      body: { code: "seat-refused", reason: "seat-allowance-exhausted" },
    });
  });

  it("admits the same member once the licence holds enough seats", async () => {
    const { auth, signIn, addUser, setLicence } = harness({ seats: 2 });
    const { cookie } = await signIn("owner@example.com");
    const organization = await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });
    setLicence(seatLicence(claims(), 2));
    const second = addUser("tester@example.com");

    const member = await auth.api.addMember({
      body: { userId: second, role: "member", organizationId: organization?.id ?? "" },
      headers: new Headers({ cookie }),
    });

    expect(member).toMatchObject({ userId: second, role: "member" });
  });

  it("refuses a second organization for one account at the default ceiling", async () => {
    const { auth, signIn } = harness();
    const { cookie } = await signIn("owner@example.com");
    await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });

    await expect(
      auth.api.createOrganization({
        body: { name: "Second", slug: "second" },
        headers: new Headers({ cookie }),
      }),
    ).rejects.toThrow(/organization/u);
  });
});

describe("a second factor for the admin role", () => {
  /** Promote a stored user, the way the admin plugin's `setRole` does. */
  function promote(store: Store, userId: string, fields: { twoFactorEnabled?: boolean }): void {
    const row = (store.user ?? []).find((entry) => (entry as { id?: string }).id === userId) as
      | { role?: string; twoFactorEnabled?: boolean }
      | undefined;
    if (row === undefined) throw new Error(`${userId} is not a stored user`);
    row.role = "admin";
    if (fields.twoFactorEnabled !== undefined) row.twoFactorEnabled = fields.twoFactorEnabled;
  }

  it("refuses an operator who has not enrolled, and says where to enrol", async () => {
    const { auth, signIn, store } = harness();
    const { cookie, userId } = await signIn("operator@example.com");
    promote(store, userId, {});

    // 403 with a code, not a generic "forbidden": the client has to open enrolment.
    await expect(
      auth.api.createOrganization({
        body: { name: "Ops", slug: "ops" },
        headers: new Headers({ cookie }),
      }),
    ).rejects.toMatchObject({
      body: { code: "mfa-enrollment-required", enrollAt: "/two-factor/enable" },
    });
    expect(store.organization).toHaveLength(0);
  });

  it("lets the same operator act once a factor is enrolled", async () => {
    const { auth, signIn, store } = harness();
    const { cookie, userId } = await signIn("operator@example.com");
    promote(store, userId, { twoFactorEnabled: true });

    const organization = await auth.api.createOrganization({
      body: { name: "Ops", slug: "ops" },
      headers: new Headers({ cookie }),
    });
    expect(organization?.slug).toBe("ops");
  });

  it("reports the requirement on the session, so the client can offer enrolment", async () => {
    const { auth, signIn, store } = harness();
    const { cookie, userId } = await signIn("operator@example.com");
    const reader = sessionReader(auth, storeMemberships(store));

    expect((await reader.sessionFor({ cookie }))?.mfaRequired).toBe(false);
    promote(store, userId, {});
    expect((await reader.sessionFor({ cookie }))?.mfaRequired).toBe(true);
  });
});

describe("invitations, and the password §11 now allows", () => {
  /** The plugin's own redemption endpoint, called the way our route calls it. */
  async function redeem(
    auth: TestAuth,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/invite/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL, ...headers },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function organizationOf(auth: TestAuth, cookie: string): Promise<{ id: string }> {
    const created = await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie }),
    });
    if (created === null) throw new Error("the organization was not created");
    return created;
  }

  it("creates an account for a stranger, and withholds the session until the address answers", async () => {
    const { auth, store, verified, lastVerification } = harness();

    await auth.api.signUpEmail({
      body: {
        email: "stranger@example.com",
        password: "correct horse battery",
        name: "Stranger",
      },
    });

    // Open sign-up (ADR-0077): the row exists and a verification message went out.
    expect(store.user ?? []).toHaveLength(1);
    expect(verified).toEqual(["stranger@example.com"]);
    expect(lastVerification()).toContain("token=");

    // The password works, but no session is issued before the address is confirmed.
    await expect(
      auth.api.signInEmail({
        body: { email: "stranger@example.com", password: "correct horse battery" },
        headers: new Headers({ origin: BASE_URL }),
      }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
  });

  it("signs the stranger in once the verification link is opened", async () => {
    const { auth, signIn, verified, lastVerification } = harness();

    await auth.api.signUpEmail({
      body: {
        email: "stranger@example.com",
        password: "correct horse battery",
        name: "Stranger",
      },
    });
    const url = lastVerification();
    if (url === null) throw new Error("no verification link was sent");
    await auth.handler(new Request(url));

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({
          email: "stranger@example.com",
          password: "correct horse battery",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeTruthy();
    expect(verified).toEqual(["stranger@example.com"]);
    // Signing in through the magic link still works for the same account, which is
    // what makes the mailbox the recovery path.
    expect((await signIn("stranger@example.com")).userId).toBeTruthy();
  });

  it("adds an invited colleague who already has an account, with the role the invitation named", async () => {
    const { auth, signIn, invitations, store } = harness({ seats: 3 });
    const owner = await signIn("owner@example.com");
    const organization = await organizationOf(auth, owner.cookie);

    await auth.api.createInvite({
      body: {
        type: "private",
        kind: "org-join",
        email: "colleague@example.com",
        organizationId: organization.id,
        organizationRole: "member",
      },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const invitation = invitations[0];
    if (invitation === undefined)
      throw new Error("the plugin never asked us to send an invitation");

    // Open sign-up (ADR-0077) means the colleague arrives with their own account and
    // the invitation is what puts them in the organization. There is no account
    // creation left in the redemption path, which is the point of the change.
    const colleague = await signIn("colleague@example.com");
    const redeemed = await redeem(auth, { token: invitation.token }, { cookie: colleague.cookie });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ action: "ACCEPTED" });

    // The owner is the first member; the colleague is the second, with the
    // organization role the invitation named (never `owner`).
    expect(store.member).toContainEqual(
      expect.objectContaining({
        organizationId: organization.id,
        userId: colleague.userId,
        role: "member",
      }),
    );
  });

  it("refuses a redemption the licence has no seat for", async () => {
    const { auth, signIn, invitations, setLicence } = harness({ seats: 2 });
    const { cookie } = await signIn("owner@example.com");
    const organization = await organizationOf(auth, cookie);

    // Created while there was room (the reservation counts the pending invite), then
    // the licence shrinks: the join must be refused at redemption, not at creation.
    await auth.api.createInvite({
      body: {
        type: "private",
        kind: "org-join",
        email: "late@example.com",
        organizationId: organization.id,
      },
      headers: new Headers({ cookie }),
    });
    setLicence(seatLicence(claims(), 1));

    const invitation = invitations[0];
    if (invitation === undefined) throw new Error("no invitation was sent");
    const late = await signIn("late@example.com");
    const redeemed = await redeem(auth, { token: invitation.token }, { cookie: late.cookie });

    expect(redeemed.status).toBe(422);
    expect(redeemed.body).toMatchObject({ code: "SEAT_LIMIT_REACHED" });
  });

  it("names a missing licence row as a provisioning fault, not a spent seat", async () => {
    // The distinction the provisioning lane added, kept at the one place that can lose
    // it: the invitation plugin answers `SEAT_LIMIT_REACHED`, an ordinal, so
    // `resolveSeatLimit` raises `LICENCE_UNPROVISIONED` before a number is answered.
    const { auth, signIn, invitations, setLicence } = harness({ seats: 2 });
    const { cookie } = await signIn("owner@example.com");
    const organization = await organizationOf(auth, cookie);

    await auth.api.createInvite({
      body: {
        type: "private",
        kind: "org-join",
        email: "late@example.com",
        organizationId: organization.id,
      },
      headers: new Headers({ cookie }),
    });
    setLicence(null);

    const invitation = invitations[0];
    if (invitation === undefined) throw new Error("no invitation was sent");
    const late = await signIn("late@example.com");
    const redeemed = await redeem(auth, { token: invitation.token }, { cookie: late.cookie });

    expect(redeemed.status).toBe(422);
    expect(redeemed.body).toMatchObject({ code: "LICENCE_UNPROVISIONED" });
    // The sentence is the one `seatProblemMessage` owns, and it says the fault is ours.
    expect(String(redeemed.body.message)).toMatch(/never provisioned/u);
  });

  it("joins a signed-in person through a shareable invite, and stops at maxUses", async () => {
    const { auth, signIn, store } = harness({ seats: 4 });
    const owner = await signIn("owner@example.com");
    const organization = await organizationOf(auth, owner.cookie);

    const created = await auth.api.createInvite({
      body: { type: "public", kind: "org-join", organizationId: organization.id, maxUses: 1 },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const token = created.token;
    if (token === undefined) throw new Error("a public invite must return its token");

    // A shareable link is not an account: without a session there is nobody to add,
    // and the plugin says so without spending a use. Our route turns that deferred
    // answer into 401 through `enrollmentRedemption`; here the plugin's own body is
    // what is asserted.
    const anonymous = await redeem(auth, { token });
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toMatchObject({ action: "SIGN_IN_REQUIRED" });
    // Crucially, a rejected attempt spends nothing: no use, no member row.
    expect(store.member?.length ?? 0).toBe(1);

    const tester = await signIn("tester@example.com");
    const redeemed = await redeem(auth, { token }, { cookie: tester.cookie });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ action: "ACCEPTED" });
    expect(store.member).toContainEqual(
      expect.objectContaining({ organizationId: organization.id, userId: tester.userId }),
    );

    // The one use is spent: the next person is refused by the same conditional claim
    // that made two simultaneous redemptions impossible before this plugin existed.
    const second = await signIn("second@example.com");
    const exhausted = await redeem(auth, { token }, { cookie: second.cookie });
    expect(exhausted.status).toBe(400);
    expect(exhausted.body).toMatchObject({ code: "INVITE_ALREADY_USED" });
  });
});

describe("invitations through the organization plugin", () => {
  /** One JSON request through the real handler. */
  async function post(
    auth: TestAuth,
    path: string,
    body: Record<string, unknown>,
    cookie?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          ...(cookie === undefined ? {} : { cookie }),
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it("emails an invitation, and adds the colleague when they accept it", async () => {
    const { auth, signIn, organizationInvitations, store } = harness({ seats: 3 });
    const owner = await signIn("owner@example.com");
    const organization = await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie: owner.cookie }),
    });

    const invited = await post(
      auth,
      "/organization/invite-member",
      { email: "colleague@example.com", role: "admin", organizationId: organization?.id },
      owner.cookie,
    );
    expect(invited.status).toBe(200);

    // The plugin wrote the row and asked us to deliver it; the link names the
    // invitation and nothing else, so it is worthless in another mailbox.
    const sent = organizationInvitations[0];
    if (sent === undefined) throw new Error("no invitation was sent");
    expect(sent).toMatchObject({
      email: "colleague@example.com",
      role: "admin",
      organizationName: "Agency",
      inviterName: expect.any(String),
    });
    expect(sent.url).toBe(`${BASE_URL}/accept-invitation?id=${encodeURIComponent(sent.id)}`);

    const colleague = await signIn("colleague@example.com");
    const accepted = await post(
      auth,
      "/organization/accept-invitation",
      { invitationId: sent.id },
      colleague.cookie,
    );
    expect(accepted.status).toBe(200);

    // The role travelled with the invitation: member, admin and owner are all
    // organization-wide, and this one was granted as admin.
    expect(store.member).toContainEqual(
      expect.objectContaining({
        organizationId: organization?.id,
        userId: colleague.userId,
        role: "admin",
      }),
    );
  });

  it("lists members and roles through the plugin, without addresses", async () => {
    const { auth, signIn } = harness();
    const owner = await signIn("owner@example.com");
    await auth.api.createOrganization({
      body: { name: "Agency", slug: "agency" },
      headers: new Headers({ cookie: owner.cookie }),
    });

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/organization/list-members`, {
        headers: { cookie: owner.cookie },
      }),
    );
    expect(response.status).toBe(200);
    const members = (await response.json()) as { members?: Array<Record<string, unknown>> };
    expect(members.members?.[0]).toMatchObject({ userId: owner.userId, role: "owner" });
  });
});

describe("sessions and devices", () => {
  it("lists the caller's sessions and revokes one", async () => {
    const { auth, signIn, store } = harness();
    const { cookie } = await signIn("reader@example.com");

    const listed = await auth.handler(
      new Request(`${BASE_URL}/api/auth/list-sessions`, { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const sessions = (await listed.json()) as Array<Record<string, unknown>>;
    const token = sessions[0]?.token;
    expect(typeof token).toBe("string");

    const revoked = await auth.handler(
      new Request(`${BASE_URL}/api/auth/revoke-session`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(revoked.status).toBe(200);
    // The cookie still exists in the browser; it no longer names a session.
    expect(await sessionReader(auth, storeMemberships(store)).sessionFor({ cookie })).toBeNull();
  });
});

describe("the passkey relying party", () => {
  it("binds to the configured rpID, or to the host the service is served from", () => {
    const pluginOf = (options: ReturnType<typeof authOptions>): Record<string, unknown> => {
      const found = (options.plugins ?? []).find(
        (entry) => (entry as { id?: string }).id === "passkey",
      );
      return (found as { options?: Record<string, unknown> } | undefined)?.options ?? {};
    };

    expect(pluginOf(authOptions(serviceDeps())).rpID).toBe("suite.example");

    const named = authOptions({
      ...serviceDeps(),
      env: authEnvironment({
        SUITE_AUTH_ENABLED: "1",
        SUITE_AUTH_SECRET: "t".repeat(40),
        SUITE_AUTH_URL: "https://accounts.suite.example",
        SUITE_AUTH_RP_ID: "suite.example",
      }),
    });
    expect(pluginOf(named).rpID).toBe("suite.example");
  });
});

describe("admission", () => {
  it("refuses an organization to an account that is still on the list", async () => {
    const { auth, signIn } = harness({ admission: true });
    const { cookie } = await signIn("waiting@example.com");

    // Held, not forbidden: the code says which, so a surface can render the queue
    // message instead of a permissions error (ADR-0067 §7).
    await expect(
      auth.api.createOrganization({
        body: { name: "Too Early", slug: "too-early" },
        headers: new Headers({ cookie }),
      }),
    ).rejects.toMatchObject({ body: { code: "admission-pending" } });
  });

  it("lets an admitted account create the organization it was waiting for", async () => {
    const { auth, signIn, admit, store } = harness({ admission: true });
    const { cookie, userId } = await signIn("admitted@example.com");

    admit(userId);
    const organization = await auth.api.createOrganization({
      body: { name: "Finally", slug: "finally" },
      headers: new Headers({ cookie }),
    });

    expect(organization?.slug).toBe("finally");
    expect(store.organization).toHaveLength(1);
  });

  it("does not gate a deployment that never asked for a queue", async () => {
    const { auth, signIn } = harness();
    const { cookie } = await signIn("self-host@example.com");

    // The default is off: a self-host with one user should not need an operator.
    const organization = await auth.api.createOrganization({
      body: { name: "Solo", slug: "solo" },
      headers: new Headers({ cookie }),
    });

    expect(organization?.slug).toBe("solo");
  });

  it("reports the admission state on the session so a route can explain itself", async () => {
    const { auth, signIn, admit, store } = harness({ admission: true });
    const { cookie, userId } = await signIn("explain@example.com");
    const reader = sessionReader(auth, storeMemberships(store));

    expect((await reader.sessionFor({ cookie }))?.admittedAt).toBeNull();

    admit(userId);
    // Read from the user row on every session: admitting takes effect without
    // asking the reader to sign in again.
    expect((await reader.sessionFor({ cookie }))?.admittedAt).toBe(NOW);
  });
});
