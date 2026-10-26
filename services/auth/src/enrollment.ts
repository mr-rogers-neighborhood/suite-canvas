import { type BetterEnrollmentOptions, betterEnrollment } from "@octopi-ai/better-enrollment";
import type { BetterAuthPlugin } from "better-auth";
import { AuthError } from "./errors.js";
import { type LicenceStore, licenceStateFor } from "./licences.js";
import { seatCeiling } from "./seats.js";

/**
 * `better-enrollment`: the invitation engine, and our wrapper around it
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §10–11).
 *
 * Two things live here and they are deliberately separate:
 *
 * 1. **Configuration** ({@link enrollmentOptions}) — what the plugin is allowed to
 *    do, including the one number it cannot compute for itself: the seat ceiling
 *    from the licence.
 * 2. **Redemption** ({@link enrollmentRedemption}) — our own route's only way in.
 *    The plugin's `/invite/redeem` answers with *its* error codes; a caller of ours
 *    gets ours, and an answer we do not recognise fails closed instead of turning
 *    into an accidental success.
 *
 * Why a wrapper at all, given the plugin already refuses revoked and expired links:
 * the codes are the contract the browser renders, and a minor release of community
 * code must not be able to widen access by renaming one of them. The wrapper is the
 * one place that says "this outcome means no".
 */

/** A private invitation, as the sender needs to see it to deliver a link. */
export interface InvitationEmail {
  email: string;
  name: string | null;
  /** The link, token included. The only time the plaintext token exists. */
  url: string;
  token: string;
  organizationName: string | null;
  organizationRole: string | null;
  inviteId: string;
  inviterName: string;
  inviterEmail: string;
  expiresAt: number | null;
}

export interface EnrollmentDeps {
  licences: LicenceStore;
  now: () => number;
  /**
   * Deliver a private invitation. Optional only so a deployment that never invites
   * anyone can omit it: with no sender, creating a private invite **throws**, and the
   * plugin rolls the row back. An invitation nobody can receive is not a quiet
   * success, it is a link the sender believes they sent.
   */
  sendInvitation?: (invitation: InvitationEmail) => Promise<void>;
  /** Called for shareable invites, where the creator gets the link back instead. */
  onPublicInvitation?: (invitation: Omit<InvitationEmail, "email" | "name">) => void;
}

/**
 * The plugin options, built from our repositories and nothing from a request body.
 *
 * Two choices here contradict the plugin's own opinions on purpose, and both are
 * recorded in ADR-0067 §10–11:
 *
 * - `mode: "invite-only"` with `allowOpenSignup: true`. The plugin's "invite-only"
 *   is an **app-wide** guarantee: nobody without an invitation gets an account. That
 *   is not this product — registration is open and admission is reviewed (§7) — so
 *   the open flag is set, which downgrades the guarantee to per-email. The half we
 *   do keep is the half that matters for passwords: `emailAndPassword.disableSignUp`
 *   means the *password* door only opens for an invitee, while passkeys, magic links
 *   and Google stay open to everyone.
 * - `passwordless: false`. The plugin would default to passwordless redemption
 *   because magic link is registered; a password is exactly what an invited account
 *   is allowed to set (§11 amendment).
 */
export function enrollmentOptions(deps: EnrollmentDeps): BetterEnrollmentOptions {
  const now = deps.now;
  return {
    mode: "invite-only",
    allowOpenSignup: true,
    passwordless: false,
    // App-level roles (`user.role`), which the admin plugin owns. An organization
    // role travels separately, in `organizationRole`, so an invitation can never
    // hand over the tenant's `owner` role (ADR-0065 §3).
    defaultRole: "user",
    validRoles: ["user"],
    hashTokens: true,
    // A leaked link must not claim somebody else's address as verified.
    autoVerifyPublicInviteEmail: false,
    // The invitee's address is not the inviter's business once the link is out.
    exposeEmailOnGet: false,
    organization: {
      allowOwnerInvites: false,
      defaultOrganizationRole: "member",
      /**
       * The seat gate the plugin can see. It writes `member` rows through the
       * adapter, so the organization plugin's `beforeAddMember` hook never fires for
       * a redemption; this callback is how the *same* licence decision reaches it
       * (see `seatCeiling`, which `checkSeatAllowance` also reads). `0` for a
       * missing or expired licence is the fail-closed answer.
       */
      resolveSeatLimit: async (organization) =>
        seatCeiling({
          licence: licenceStateFor(true, await deps.licences.forOrganization(organization.id)),
          now: now(),
        }),
    },
    sendPrivateInvitation: async (data) => {
      const send = deps.sendInvitation;
      if (send === undefined) {
        throw new Error(
          "no invitation sender is configured; refusing to create an invitation nobody receives",
        );
      }
      await send({
        email: data.email,
        name: data.name,
        url: data.url,
        token: data.token,
        organizationName: data.organizationName,
        organizationRole: data.organizationRole,
        inviteId: data.inviteId,
        inviterName: data.inviterName,
        inviterEmail: data.inviterEmail,
        expiresAt: data.expiresAt === null ? null : data.expiresAt.getTime(),
      });
    },
    sendPublicInvitation: (data) => {
      deps.onPublicInvitation?.({
        url: data.url,
        token: data.token,
        organizationName: data.organizationName,
        organizationRole: data.organizationRole,
        inviteId: data.inviteId,
        inviterName: data.inviterName,
        inviterEmail: data.inviterEmail,
        expiresAt: data.expiresAt === null ? null : data.expiresAt.getTime(),
      });
    },
  };
}

/**
 * The plugin itself: {@link enrollmentOptions}, registered.
 *
 * The cast is a typing edge, stated rather than hidden: the plugin declares its
 * `schema.organization` / `schema.user` entries as optional *properties* whose type
 * includes `undefined`, which this repository's `exactOptionalPropertyTypes` refuses to
 * accept in an index signature. The runtime shape is the one Better Auth's own
 * `getAuthTables()` reads — `pluginSchema.test.ts` asserts the tables it produces, so a
 * real schema regression cannot hide behind this line.
 */
export function enrollmentPlugin(deps: EnrollmentDeps): BetterAuthPlugin {
  return betterEnrollment(enrollmentOptions(deps)) as unknown as BetterAuthPlugin;
}

/** The two answers our redemption route is allowed to give. */
export type EnrollmentOutcome =
  /** The invitation is spent and the person is a member (or now has a password). */
  | {
      status: "redeemed";
      organizationId: string | null;
      /** The organization role granted, when the plugin names one. */
      role: string | null;
      /** True when Better Auth also established a session (passwordless paths only). */
      signedIn: boolean;
    }
  /** Nothing was written; the person must sign in and present the link again. */
  | { status: "sign-in-required" };

export interface EnrollmentRedeemInput {
  /** The token from the invitation link. The only secret this route takes. */
  token: string;
  /** The password a private invitee sets. Omitted when they already have an account. */
  password?: string;
  name?: string;
  /** Public invites: the address the account is created with. */
  email?: string;
  /**
   * The inbound headers, so a signed-in accepter of a shareable link is recognised by
   * their cookie. Never trusted for identity beyond what Better Auth verifies.
   */
  headers?: Record<string, string | undefined>;
}

export type EnrollmentRedemption = (input: EnrollmentRedeemInput) => Promise<EnrollmentOutcome>;

/** The one Better Auth route this wrapper is allowed to call. */
const REDEEM_PATH = "/api/auth/invite/redeem";

/**
 * The plugin's error code → ours.
 *
 * Everything the plugin can say about an invitation is here, mapped to the codes the
 * browser already renders. A code that is not in this table is **not** a success: it
 * becomes `forbidden` (or a 5xx, for a server fault), which is the failing-closed
 * direction for an unrecognised answer.
 */
const OUTCOME_BY_PLUGIN_CODE: Readonly<Record<string, AuthError["code"]>> = {
  INVITE_NOT_FOUND: "invite-not-found",
  INVITE_EXPIRED: "invite-expired",
  INVITE_REVOKED: "invite-revoked",
  INVITE_ALREADY_USED: "invite-exhausted",
  INVITE_USES_EXHAUSTED: "invite-exhausted",
  SEAT_LIMIT_REACHED: "seat-refused",
  ORG_DISABLED: "forbidden",
  ORG_INVITE_NOT_ALLOWED: "forbidden",
  USER_BANNED: "forbidden",
  EMAIL_MISMATCH: "forbidden",
  EMAIL_NOT_VERIFIED: "forbidden",
  INVITATION_REQUIRED: "forbidden",
  // The invitation is fine and the account is fine; the request is not.
  NAME_REQUIRED: "invalid-request",
  PASSWORD_REQUIRED: "invalid-request",
  PASSWORD_NOT_AVAILABLE: "invalid-request",
  ADDITIONAL_FIELD_REQUIRED: "invalid-request",
  ADDITIONAL_FIELD_INVALID: "invalid-request",
  ORG_INFO_REQUIRED: "invalid-request",
};

interface PluginBody {
  code?: unknown;
  message?: unknown;
  action?: unknown;
  role?: unknown;
  signedIn?: unknown;
  organization?: unknown;
}

function messageOf(body: PluginBody, fallback: string): string {
  return typeof body.message === "string" && body.message.length > 0 ? body.message : fallback;
}

function organizationIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Turns the plugin's HTTP answer into {@link EnrollmentOutcome} or an {@link AuthError}.
 *
 * Exported so the mapping can be pinned without standing up Better Auth; the route
 * only ever calls {@link enrollmentRedemption}.
 */
export function redemptionResult(status: number, body: PluginBody): EnrollmentOutcome {
  if (status === 429) {
    throw new AuthError("rate-limited", "too many invitation attempts; try again in a minute");
  }
  if (status >= 500) {
    // A plugin fault is not a decision about this invitation — even if the body
    // carries a code we know, a 5xx means the write may or may not have happened. It
    // is reported as an outage, never as a named refusal.
    throw new Error(`the invitation engine failed: ${messageOf(body, String(status))}`);
  }
  if (status < 200 || status >= 300) {
    const code = typeof body.code === "string" ? body.code : null;
    const mapped = code === null ? undefined : OUTCOME_BY_PLUGIN_CODE[code];
    if (mapped !== undefined) {
      throw new AuthError(mapped, messageOf(body, "the invitation was refused"));
    }
    // Unrecognised 4xx. `invalid-request` would tell a caller what to fix, which we
    // cannot know; `forbidden` is the honest, closed answer.
    throw new AuthError("forbidden", messageOf(body, "the invitation was refused"));
  }

  if (body.action === "SIGN_IN_REQUIRED") return { status: "sign-in-required" };
  if (body.action === "ACCEPTED") {
    return {
      status: "redeemed",
      organizationId: organizationIdOf(body.organization),
      role: typeof body.role === "string" ? body.role : null,
      signedIn: body.signedIn === true,
    };
  }
  // A 2xx we do not understand is still not a redemption.
  throw new AuthError(
    "forbidden",
    "the invitation engine answered something this route does not know",
  );
}

export interface RedemptionOptions {
  /** Origin the session cookie is scoped to; also the base of the internal request. */
  baseURL: string;
  /** The constructed Better Auth instance's `Request` handler. */
  handler: (request: Request) => Promise<Response>;
}

/**
 * Our redemption port: one token in, our outcome out.
 *
 * The internal request is a real `Request` through the real handler, which is the
 * only way to run the plugin's endpoints with its own middleware (rate limiting,
 * session resolution) instead of re-implementing them. Only the inbound cookie is
 * forwarded — no other header is trusted, and `origin` is ours so a request cannot
 * arrive here pre-authorised by something upstream.
 */
export function enrollmentRedemption(options: RedemptionOptions): EnrollmentRedemption {
  return async (input) => {
    const url = new URL(REDEEM_PATH, options.baseURL);
    const headers = new Headers({
      "content-type": "application/json",
      origin: options.baseURL,
    });
    const cookie = input.headers?.cookie;
    if (typeof cookie === "string" && cookie.length > 0) headers.set("cookie", cookie);

    const payload: Record<string, string> = { token: input.token };
    if (input.password !== undefined) payload.password = input.password;
    if (input.name !== undefined) payload.name = input.name;
    if (input.email !== undefined) payload.email = input.email;

    const response = await options.handler(
      new Request(url, { method: "POST", headers, body: JSON.stringify(payload) }),
    );

    let body: PluginBody = {};
    try {
      const parsed: unknown = await response.json();
      if (typeof parsed === "object" && parsed !== null) body = parsed as PluginBody;
    } catch {
      // A non-JSON answer is not a redemption; `redemptionResult` decides what it is.
      body = {};
    }
    return redemptionResult(response.status, body);
  };
}
