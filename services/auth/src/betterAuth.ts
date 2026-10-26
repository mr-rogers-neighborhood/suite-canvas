import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import {
  authConfigProblems,
  authEnabled,
  googleConfigured,
  maxOrganizationsPerUser,
} from "./env.js";
import { AuthError } from "./errors.js";
import { type LicenceStore, licenceStateFor, type MembershipReader } from "./licences.js";
import { checkSeatAllowance } from "./seats.js";
import type { AccountSession, AuthEnvironment } from "./types.js";

/**
 * Better Auth, configured for the three ways in the ADR names: passkeys, a magic
 * link, and Google. No passwords — a password is a secret people reuse, and this
 * product already has one thing people lose.
 *
 * The instance is constructed from an injected `database` adapter rather than
 * from a connection string, for one reason that matters more than convenience:
 * every rule in this service has to be testable without a live Postgres, and the
 * memory adapter Better Auth ships makes the *real* plugin, the *real* hooks and
 * the *real* session cookie exercisable in `pnpm test`. Production passes a
 * Postgres adapter here; see README.md for what that costs today.
 *
 * Teams are deliberately not enabled. Our sync unit is one document per
 * connection, so the finest access we can *enforce* is per workspace: a team
 * would have to be a set of workspace grants (ADR-0065 amendment §5), and a
 * "team" that merely looked finer inside one document would be a promise the
 * relay breaks on the first sync.
 */

/**
 * Better Auth's own database option, taken from its option type rather than
 * redeclared: the service never calls the adapter, but a wrong shape here would
 * only fail when the first login ran. No driver is imported by this module.
 */
export type AuthDatabase = NonNullable<Parameters<typeof betterAuth>[0]["database"]>;

/** The plugin hook's error type, imported lazily at the type level only. */
type HookRefusal = Error & { status?: string; body?: unknown };

export interface AuthServiceDeps {
  env: AuthEnvironment;
  /** Better Auth adapter: the memory adapter in tests, Postgres in production. */
  database: AuthDatabase;
  licences: LicenceStore;
  memberships: MembershipReader;
  /** Deliver a magic link. Required by the plugin; the route only runs when configured. */
  sendMagicLink: (input: { email: string; url: string; token: string }) => Promise<void>;
  now?: () => number;
}

/** Minimal shape this service needs from the constructed instance. */
export interface AuthInstance {
  api: {
    getSession: (input: { headers: Headers }) => Promise<AuthSessionPayload | null>;
  };
  handler: (request: Request) => Promise<Response>;
}

interface AuthSessionPayload {
  user: { id: string; email?: string | null };
  session: { activeOrganizationId?: string | null };
}

/** The refusal the plugin will surface as a 403 with our code in the body. */
function refusal(code: string, message: string): HookRefusal {
  const error = new Error(message) as HookRefusal;
  error.name = "APIError";
  error.status = "FORBIDDEN";
  error.body = { code, message };
  return error;
}

/**
 * The licence refusal a hook raises, or null when the join fits.
 *
 * This is the same pure `checkSeatAllowance` the relay uses; the hook supplies
 * the organization's current member count and the licence row. A hook that
 * touched a document would be a hook that could corrupt one, so this one reads
 * two numbers and nothing else.
 */
async function seatRefusal(
  deps: AuthServiceDeps,
  organizationId: string,
  now: number,
): Promise<HookRefusal | null> {
  const licence = await deps.licences.forOrganization(organizationId);
  const memberCount = await deps.memberships.countForOrganization(organizationId);
  const decision = checkSeatAllowance({
    organizationId,
    licence: licenceStateFor(true, licence),
    memberCount: memberCount + 1,
    now,
  });
  if (decision.ok) return null;
  return refusal(
    "seat-refused",
    `the organization has no seat for another member: ${decision.reason}`,
  );
}

/**
 * Builds the Better Auth instance.
 *
 * Throws `auth-not-configured` rather than constructing a half-working instance:
 * a session that cannot be verified is worse than an obvious outage, because the
 * relay would then treat an account request as anonymous.
 */
export function createAuthService(deps: AuthServiceDeps): AuthInstance {
  const { env } = deps;
  if (!authEnabled(env)) {
    throw new AuthError("auth-not-configured", "SUITE_AUTH_ENABLED is not 1");
  }
  const problems = authConfigProblems(env);
  if (problems.length > 0) {
    throw new AuthError(
      "auth-not-configured",
      problems.map((entry) => `${entry.variable} ${entry.problem}`).join("; "),
    );
  }
  const now = deps.now ?? Date.now;
  const maxOrganizations = maxOrganizationsPerUser(env);

  const instance = betterAuth({
    baseURL: env.SUITE_AUTH_URL?.trim(),
    secret: env.SUITE_AUTH_SECRET?.trim(),
    database: deps.database,
    emailAndPassword: { enabled: false },
    ...(googleConfigured(env)
      ? {
          socialProviders: {
            google: {
              clientId: env.SUITE_GOOGLE_CLIENT_ID?.trim() ?? "",
              clientSecret: env.SUITE_GOOGLE_CLIENT_SECRET?.trim() ?? "",
            },
          },
        }
      : {}),
    plugins: [
      organization({
        // Teams stay off until an ADR defines them as workspace grants; see the
        // module comment above for why a finer grain cannot be enforced.
        teams: { enabled: false },
        organizationHooks: {
          beforeCreateOrganization: async ({ user }) => {
            const owned = await deps.memberships.countForUser(user.id);
            if (owned >= maxOrganizations) {
              throw refusal(
                "forbidden",
                `this account already holds ${owned} organization(s); the deployment allows ${maxOrganizations}`,
              );
            }
          },
          beforeAddMember: async ({ organization: target, member }) => {
            // Adding the creator as owner is the organization's first member and
            // is bounded by the licence's seat count like any other join.
            const denied = await seatRefusal(deps, member.organizationId ?? target.id, now());
            if (denied !== null) throw denied;
          },
          beforeAcceptInvitation: async ({ organization: target, user }) => {
            const role = await deps.memberships.roleFor(target.id, user.id);
            if (role !== null) return;
            const denied = await seatRefusal(deps, target.id, now());
            if (denied !== null) throw denied;
          },
        },
      }),
      magicLink({
        expiresIn: 10 * 60,
        sendMagicLink: async ({ email, url, token }) => {
          await deps.sendMagicLink({ email, url, token });
        },
      }),
      passkey({
        rpID: env.SUITE_AUTH_RP_ID?.trim() || "localhost",
        rpName: env.SUITE_AUTH_RP_NAME?.trim() || "Suite",
      }),
    ],
  });

  return instance as unknown as AuthInstance;
}

function headersOf(input: Record<string, string | undefined> | null | undefined): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input ?? {})) {
    if (typeof value === "string") headers.set(name, value);
  }
  return headers;
}

/**
 * The session boundary the routes use.
 *
 * Two facts are read server-side and never from a body: the account id, and the
 * active organization Better Auth put on the session. The role is then looked up
 * in `member`, so a removed member's live session stops resolving to an account
 * principal the moment the row is gone.
 */
export function sessionReader(
  instance: AuthInstance,
  memberships: MembershipReader,
): { sessionFor: (headers: Record<string, string | undefined>) => Promise<AccountSession | null> } {
  return {
    sessionFor: async (headers) => {
      let payload: AuthSessionPayload | null;
      try {
        payload = await instance.api.getSession({ headers: headersOf(headers) });
      } catch {
        // A malformed cookie is not a server error: it is simply no session.
        return null;
      }
      if (payload === null) return null;
      const organizationId = payload.session.activeOrganizationId ?? null;
      if (organizationId === null) {
        return { userId: payload.user.id, organizationId: null, role: null };
      }
      const role = await memberships.roleFor(organizationId, payload.user.id);
      return { userId: payload.user.id, organizationId, role };
    },
  };
}
