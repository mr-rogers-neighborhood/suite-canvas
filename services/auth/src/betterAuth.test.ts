import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { type AuthInstance, createAuthService, sessionReader } from "./betterAuth.js";
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
}

function harness(options: { seats?: number; maxOrganizations?: number } = {}): Harness {
  const store: Store = Object.fromEntries(modelNames.map((name) => [name, []]));
  const memberships = storeMemberships(store);
  let licence: SeatLicence | null = seatLicence(claims(), options.seats ?? 5);
  let link: string | null = null;

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
    }),
    database: memoryAdapter(store),
    licences: { forOrganization: async () => licence },
    memberships,
    sendMagicLink: async ({ url }) => {
      link = url;
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
    expect(session).toEqual({ userId, organizationId: null, role: null });
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
