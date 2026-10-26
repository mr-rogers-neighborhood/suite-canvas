import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import {
  admin,
  anonymous,
  captcha,
  lastLoginMethod,
  magicLink,
  organization,
  twoFactor,
} from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import {
  ADMISSION_PENDING_CODE,
  ADMISSION_PENDING_MESSAGE,
  admissionRequired,
  admitted,
  isAdmissionGatedPath,
} from "./admission.js";
import { enrollmentPlugin, type InvitationEmail } from "./enrollment.js";
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
 * Better Auth, configured for the ways in the ADR names: passkeys, a magic link,
 * Google, and — since the §11 amendment — a password, but **only for an account an
 * invitation created**. Self-serve sign-up is closed (`emailAndPassword.disableSignUp`),
 * so the password door is a door an operator opened by inviting somebody, not a form
 * on the front page. Every other way in stays open to everyone.
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
  /**
   * Deliver a private invitation. Optional because a deployment may never invite
   * anyone; when it is absent, creating a private invite throws and the plugin rolls
   * the row back, so an invitation nobody can receive is never a quiet success.
   */
  sendInvitation?: (invitation: InvitationEmail) => Promise<void>;
  /** Called for shareable invites, whose creator receives the link instead. */
  onPublicInvitation?: (invitation: Omit<InvitationEmail, "email" | "name">) => void;
  /**
   * Hand everything an anonymous account owned to the account that just signed up.
   *
   * Better Auth calls this from `anonymous`'s `onLinkAccount` **before** it deletes
   * the anonymous user, which is the only window in which the rows still name
   * someone. It is injected so this service never depends on the workspace
   * repository: the callback moves *ownership*, and a bug in it must be testable
   * without a database.
   */
  transferAnonymousWorkspaces?: (input: { fromUserId: string; toUserId: string }) => Promise<void>;
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
  user: { id: string; email?: string | null; admittedAt?: number | null };
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
/**
 * The Better Auth options, built from the environment and the injected repositories.
 *
 * Exported because the *schema* is a property of this object, not of the instance:
 * a test can ask Better Auth what tables and fields these plugins contribute, which
 * is the only way to know that a plugin is really wired rather than merely imported.
 */
export function authOptions(deps: AuthServiceDeps): BetterAuthOptions {
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

  const needsAdmission = admissionRequired(env);
  const turnstile = env.SUITE_TURNSTILE_SECRET?.trim();

  return {
    baseURL: env.SUITE_AUTH_URL?.trim(),
    secret: env.SUITE_AUTH_SECRET?.trim(),
    database: deps.database,
    // Enabled, and sign-up closed: a password can only be *set* by redeeming an
    // invitation (`invite/redeem`), never by visiting a sign-up form. The pair is what
    // makes "self-serve sign-up stays closed" true for the one route that can be
    // brute-forced (ADR-0067 §11 amendment).
    emailAndPassword: { enabled: true, disableSignUp: true },
    /**
     * A password is the only credential here that can be guessed, so the route that
     * accepts one is named explicitly rather than left to a framework default: Better
     * Auth's limiter (on by default in production) throttles `/sign-in/*` to 3 per
     * 10 s, and pinning the rule means a future default cannot quietly widen it.
     * Storage is memory by default, which is per instance — a deployment running more
     * than one instance must point `rateLimit.storage` at a shared store.
     */
    rateLimit: { customRules: { "/sign-in/email": { window: 10, max: 3 } } },
    user: {
      additionalFields: {
        /**
         * When an operator admitted this account, or null while it waits. `input:
         * false` because only the admin surface writes it: a field a client could
         * set is a field that admits itself.
         */
        admittedAt: { type: "number", required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Admission is a licensing gate, not an authentication one: it never
        // decides who may read a document, only who may spend our storage or
        // join a tenant (ADR-0067 §7).
        if (!needsAdmission) return;
        if (!isAdmissionGatedPath(ctx.path)) return;
        // Resolved here rather than read from `ctx.context.session`: a global `before`
        // hook runs before the endpoint's own session middleware, so the context is
        // still empty at this point and a gate that trusted it would never fire.
        const session = await getSessionFromCtx(ctx);
        // No session is a *sign-up*, which is exactly what admission allows.
        if (session === null) return;
        const user = session.user as { admittedAt?: number | null };
        if (admitted(user, true)) return;
        throw refusal(ADMISSION_PENDING_CODE, ADMISSION_PENDING_MESSAGE);
      }),
    },
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
            //
            // This hook is the **only** seat gate for member rows the organization
            // plugin writes (`addMember`, accepting one of *its* invitations). It is
            // deliberately not duplicated anywhere else in our code: an invitation
            // redeemed through `better-enrollment` creates its `member` row with the
            // adapter directly, so no organization hook can see it. That claim is
            // answered by the same licence decision through
            // `organization.resolveSeatLimit` (`seatCeiling` in `seats.ts`), which is
            // a second *call site* for one policy, not a second policy. See ADR-0067
            // §10 and the note in `enrollment.ts`.
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
      // A session with no PII, so a first launch can be a real user from minute one.
      // `onLinkAccount` is the whole point: it fires on the first real sign-in, and
      // it runs before Better Auth deletes the anonymous user.
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await deps.transferAnonymousWorkspaces?.({
            fromUserId: anonymousUser.user.id,
            toUserId: newUser.user.id,
          });
        },
      }),
      // Remembers the method that worked, so the sign-in screen can offer it first
      // instead of presenting four equal doors (ADR-0067 §11).
      lastLoginMethod(),
      // Available to every account: the *nudge* follows the sign-in method and
      // requirement follows capability (`mfa.ts`), because a passkey is already two
      // factors while a magic link is one, and the mailbox is the whole account.
      twoFactor({ issuer: env.SUITE_AUTH_RP_NAME?.trim() || "Suite" }),
      // `admin` supplies the user role field and the management endpoints the admin
      // panel's people/ops half is built on (ADR-0068 §7). It is registered before
      // `better-enrollment` because the plugin's management gate reads that role.
      admin(),
      // The invitation engine: email-bound private invites that set a password,
      // shareable capped revocable public invites, and the seat limit it reads from
      // our licence (ADR-0067 §10). Configuration and the redemption wrapper live in
      // `enrollment.ts`; nothing here trusts a request body.
      enrollmentPlugin({
        licences: deps.licences,
        now,
        ...(deps.sendInvitation === undefined ? {} : { sendInvitation: deps.sendInvitation }),
        ...(deps.onPublicInvitation === undefined
          ? {}
          : { onPublicInvitation: deps.onPublicInvitation }),
      }),
      // Normalization before anything else touches an address: `foo+temp@gmail.com`
      // and `foo@gmail.com` are one person, and per-seat billing makes a duplicate
      // account a duplicate seat. It also blocks 55k disposable domains, which keeps
      // the admission queue short (ADR-0067 §9).
      emailHarmony(),
      // Invisible challenge in front of sign-up, only where a deployment opted in.
      ...(turnstile === "" || turnstile === undefined
        ? []
        : [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: turnstile,
            }),
          ]),
    ],
  };
}

/** Builds the Better Auth instance from {@link authOptions}. */
export function createAuthService(deps: AuthServiceDeps): AuthInstance {
  const instance = betterAuth(authOptions(deps));
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
      // Read from the user row on every session, not cached on it: admitting someone
      // then takes effect without asking them to sign in again.
      const admittedAt =
        typeof payload.user.admittedAt === "number" ? payload.user.admittedAt : null;
      const organizationId = payload.session.activeOrganizationId ?? null;
      if (organizationId === null) {
        return { userId: payload.user.id, organizationId: null, role: null, admittedAt };
      }
      const role = await memberships.roleFor(organizationId, payload.user.id);
      return { userId: payload.user.id, organizationId, role, admittedAt };
    },
  };
}
