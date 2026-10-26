import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { type AuthInstance, createAuthService, sessionReader } from "./betterAuth.js";
import type { InvitationEmail } from "./enrollment.js";
import { authEnvironment } from "./env.js";
import type { MembershipReader } from "./licences.js";
import { seatLicence } from "./seats.js";
import type { LicenceClaims, SeatLicence } from "./types.js";

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
  // `user`/`session`, anonymous and last-login-method add fields, captcha adds none.
  "twoFactor",
  // `better-enrollment`: the invitation row and its append-only use log.
  "invite",
  "inviteUse",
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
  /** What `onLinkAccount` asked to move, in call order. */
  transfers: Array<{ fromUserId: string; toUserId: string }>;
  /** Private invitations handed to the sender, in order. */
  invitations: InvitationEmail[];
  /** The magic link the plugin asked us to deliver, if any. */
  lastLink: () => string | null;
}

function harness(
  options: { seats?: number; maxOrganizations?: number; admission?: boolean } = {},
): Harness {
  const store: Store = Object.fromEntries(modelNames.map((name) => [name, []]));
  const memberships = storeMemberships(store);
  let licence: SeatLicence | null = seatLicence(claims(), options.seats ?? 5);
  let link: string | null = null;
  const transfers: Array<{ fromUserId: string; toUserId: string }> = [];
  const invitations: InvitationEmail[] = [];

  const auth = createAuthService({
    env: authEnvironment({
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
    }),
    database: memoryAdapter(store),
    licences: { forOrganization: async () => licence },
    memberships,
    sendMagicLink: async ({ url }) => {
      link = url;
    },
    transferAnonymousWorkspaces: async (input) => {
      transfers.push(input);
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
    transfers,
    invitations,
    lastLink: () => link,
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
    expect(session).toEqual({ userId, organizationId: null, role: null, admittedAt: null });
  });

  it("returns no session for a cookie it did not issue", async () => {
    const { auth, store } = harness();
    const reader = sessionReader(auth, storeMemberships(store));
    expect(await reader.sessionFor({ cookie: "better-auth.session_token=forged" })).toBeNull();
    expect(await reader.sessionFor({})).toBeNull();
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

    await expect(
      auth.api.addMember({
        body: { userId: second, role: "member", organizationId: organization?.id ?? "" },
        headers: new Headers({ cookie }),
      }),
    ).rejects.toThrow(/seat/u);
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

  it("refuses a self-serve password sign-up, so a password is reachable only by invitation", async () => {
    const { auth, store } = harness();

    await expect(
      auth.api.signUpEmail({
        body: {
          email: "stranger@example.com",
          password: "correct horse battery",
          name: "Stranger",
        },
      }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });

    // Refused, not merely unanswered: no account was created on the way out.
    expect(store.user ?? []).toHaveLength(0);
  });

  it("lets an invited account set a password, and signs it in with that password", async () => {
    const { auth, signIn, invitations, store } = harness({ seats: 3 });
    const { cookie } = await signIn("owner@example.com");
    const organization = await organizationOf(auth, cookie);

    await auth.api.createInvite({
      body: {
        type: "private",
        kind: "org-join",
        email: "colleague@example.com",
        organizationId: organization.id,
        organizationRole: "member",
      },
      headers: new Headers({ cookie }),
    });
    const invitation = invitations[0];
    if (invitation === undefined)
      throw new Error("the plugin never asked us to send an invitation");

    const redeemed = await redeem(auth, {
      token: invitation.token,
      password: "correct horse battery",
      name: "Colleague",
    });
    expect(redeemed.status).toBe(200);
    // `signedIn: false` because this path sets a password instead of a session: the
    // person signs in with what they just chose.
    expect(redeemed.body).toMatchObject({ action: "ACCEPTED", signedIn: false });

    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({
          email: "colleague@example.com",
          password: "correct horse battery",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const sessionCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(sessionCookie).not.toBe("");

    const session = await sessionReader(auth, storeMemberships(store)).sessionFor({
      cookie: sessionCookie,
    });
    expect(session?.userId).toBeDefined();
    // The owner is the first member; the invited colleague is the second, with the
    // organization role the invitation named (never `owner`).
    expect(store.member).toContainEqual(
      expect.objectContaining({
        organizationId: organization.id,
        userId: session?.userId,
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
    const redeemed = await redeem(auth, {
      token: invitation.token,
      password: "correct horse battery",
      name: "Late",
    });

    expect(redeemed.status).toBe(422);
    expect(redeemed.body).toMatchObject({ code: "SEAT_LIMIT_REACHED" });
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
    // and the plugin says so without spending a use.
    const anonymous = await redeem(auth, { token });
    // Be precise about what a public invite *is* once invited accounts may have
    // passwords: someone holding the link is offered an account, and the plugin asks
    // them to set one. That is the approved trade (ADR-0067 §11 amendment) and it is
    // why the cap, the expiry, the revocation and the seat check all matter here —
    // the link, not a mailbox, is what proves eligibility.
    expect(anonymous.status).toBe(400);
    expect(anonymous.body).toMatchObject({ code: "PASSWORD_REQUIRED" });
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

describe("an anonymous account that signs up", () => {
  const anonymousSignIn = async (auth: TestAuth): Promise<{ cookie: string; userId: string }> => {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: "{}",
      }),
    );
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (cookie.length === 0) throw new Error("no anonymous session cookie");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (session === null) throw new Error("the anonymous cookie resolved to no session");
    return { cookie, userId: session.user.id };
  };

  it("hands its workspaces to the real account before the anonymous user is deleted", async () => {
    const { auth, transfers, lastLink, signIn } = harness();
    const anonymous = await anonymousSignIn(auth);

    // The anonymous cookie rides the sign-in, which is how the plugin knows there is
    // something to link: without it this is an ordinary first sign-in.
    await auth.api.signInMagicLink({
      body: { email: "founder@example.com" },
      headers: new Headers({ origin: BASE_URL, cookie: anonymous.cookie }),
    });
    const link = lastLink();
    if (link === null) throw new Error("the plugin never asked for a magic link");
    await auth.handler(
      new Request(link, { redirect: "manual", headers: { cookie: anonymous.cookie } }),
    );

    const real = await signIn("founder@example.com");
    expect(transfers).toEqual([{ fromUserId: anonymous.userId, toUserId: real.userId }]);
  });
});
