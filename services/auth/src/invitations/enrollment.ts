import { type BetterEnrollmentOptions, betterEnrollment } from "@octopi-ai/better-enrollment";
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import { err, ok, type Result } from "neverthrow";
import type { AuthErrorCode } from "../http/errors.js";
import { type LicenceStore, licenceStateFor } from "../licensing/licences.js";
import { type SeatRefusal, seatCeiling, seatProblemMessage } from "../organizations/seats.js";

/**
 * `better-enrollment`: the invitation engine, and our wrapper around it
 * (ADR-0067 §10–11).
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

/**
 * The plugin code that names a missing licence row.
 *
 * `SEAT_LIMIT_REACHED` is the plugin's own ordinal answer and cannot carry a reason, so
 * a provisioning fault is given its own code where the seat limit is resolved.
 */
export const UNPROVISIONED_CODE = "LICENCE_UNPROVISIONED";

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
 * Two choices here are worth stating, and both follow ADR-0077:
 *
 * - `mode: "open"`. The plugin's "invite-only" mode is an **app-wide** guarantee:
 *   nobody without an invitation gets an account. That is not this product — a
 *   stranger signs up, verifies an address and pays — so the mode is open and an
 *   invitation is what it is everywhere else: adding a colleague to an organization.
 *   The invitation's own guarantees (one address, one use, an expiry, a revocation,
 *   the licence's seat ceiling) still apply to the invitation.
 * - `passwordless: false`. The plugin would default to passwordless redemption
 *   because magic link is registered; a password is exactly what an invited account
 *   is allowed to set.
 */
export function enrollmentOptions(deps: EnrollmentDeps): BetterEnrollmentOptions {
  const now = deps.now;
  return {
    mode: "open",
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
       * (see `seatCeiling`, which `checkSeatAllowance` also reads). `0` for a missing
       * or expired licence is the fail-closed answer.
       *
       * The plugin compares the member count against this number and refuses with its
       * own `SEAT_LIMIT_REACHED`, which is an ordinal and not a reason: an organization
       * with no row at all would arrive as "this organization has no seats remaining"
       * and read as a billing answer. A missing row is a provisioning fault, so it is
       * named here — before the number is answered — and `redemptionResult` maps the
       * code back to `licence-unprovisioned`.
       */
      resolveSeatLimit: async (organization) => {
        const licence = await deps.licences.forOrganization(organization.id);
        const state = licenceStateFor(true, licence);
        if (state.kind === "unlicensed") {
          throw new APIError("UNPROCESSABLE_ENTITY", {
            code: UNPROVISIONED_CODE,
            message: seatProblemMessage("licence-unprovisioned"),
          });
        }
        return seatCeiling({ licence: state, now: now() });
      },
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

export type EnrollmentRedemption = (
  input: EnrollmentRedeemInput,
) => Promise<Result<EnrollmentOutcome, RedemptionRefusal>>;

/**
 * Why a redemption did not happen.
 *
 * Two kinds, because the caller answers them differently and must not confuse them:
 * `refused` is a decision about *this invitation* and carries one of our codes, which
 * the route renders with its status; `engine-failed` is an outage in the invitation
 * engine, where the write may or may not have landed, and the only honest answer is a
 * retryable 5xx.
 */
export type RedemptionRefusal =
  | {
      readonly kind: "refused";
      readonly code: AuthErrorCode;
      readonly message: string;
      /**
       * The seat refusal behind a `seat-refused`, when this route could name it.
       *
       * `seat-refused` is the family; the reason is what tells a provisioning fault
       * (`licence-unprovisioned`) from "buy a plan" (`seat-allowance-exhausted`), and
       * the message says the same thing in words the browser can render.
       */
      readonly reason?: SeatRefusal;
    }
  | { readonly kind: "engine-failed"; readonly message: string };

function refused(code: AuthErrorCode, message: string, reason?: SeatRefusal): RedemptionRefusal {
  return { kind: "refused", code, message, ...(reason === undefined ? {} : { reason }) };
}

/** The one Better Auth route this wrapper is allowed to call. */
const REDEEM_PATH = "/api/auth/invite/redeem";

/** One refusal in our vocabulary, with the seat reason it came from when there is one. */
interface RefusalMapping {
  code: AuthErrorCode;
  reason?: SeatRefusal;
}

/**
 * The plugin's error code → ours.
 *
 * Everything the plugin can say about an invitation is here, mapped to the codes the
 * browser already renders. A code that is not in this table is **not** a success: it
 * becomes `forbidden` (or a 5xx, for a server fault), which is the failing-closed
 * direction for an unrecognised answer.
 *
 * `LICENCE_UNPROVISIONED` is ours, not the plugin's: `resolveSeatLimit` raises it because
 * the plugin's own `SEAT_LIMIT_REACHED` is an ordinal and would report a missing licence
 * row as a spent allowance.
 */
const OUTCOME_BY_PLUGIN_CODE: Readonly<Record<string, RefusalMapping>> = {
  INVITE_NOT_FOUND: { code: "invite-not-found" },
  INVITE_EXPIRED: { code: "invite-expired" },
  INVITE_REVOKED: { code: "invite-revoked" },
  INVITE_ALREADY_USED: { code: "invite-exhausted" },
  INVITE_USES_EXHAUSTED: { code: "invite-exhausted" },
  SEAT_LIMIT_REACHED: { code: "seat-refused", reason: "seat-allowance-exhausted" },
  [UNPROVISIONED_CODE]: { code: "seat-refused", reason: "licence-unprovisioned" },
  ORG_DISABLED: { code: "forbidden" },
  ORG_INVITE_NOT_ALLOWED: { code: "forbidden" },
  USER_BANNED: { code: "forbidden" },
  EMAIL_MISMATCH: { code: "forbidden" },
  EMAIL_NOT_VERIFIED: { code: "forbidden" },
  INVITATION_REQUIRED: { code: "forbidden" },
  // The invitation is fine and the account is fine; the request is not.
  NAME_REQUIRED: { code: "invalid-request" },
  PASSWORD_REQUIRED: { code: "invalid-request" },
  PASSWORD_NOT_AVAILABLE: { code: "invalid-request" },
  ADDITIONAL_FIELD_REQUIRED: { code: "invalid-request" },
  ADDITIONAL_FIELD_INVALID: { code: "invalid-request" },
  ORG_INFO_REQUIRED: { code: "invalid-request" },
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
 * Turns the plugin's HTTP answer into an {@link EnrollmentOutcome} or a refusal.
 *
 * Exported so the mapping can be pinned without standing up Better Auth; the route
 * only ever calls {@link enrollmentRedemption}. The answer is a `Result` rather than
 * a throw because every branch here is an *expected* answer from a service we do not
 * control: a refusal, a fault, or a success. Throwing made the caller reconstruct
 * which of its own codes an unrecognised plugin reply had become; returning the
 * refusal makes the mapping exhaustive and testable as data.
 */
export function redemptionResult(
  status: number,
  body: PluginBody,
): Result<EnrollmentOutcome, RedemptionRefusal> {
  if (status === 429) {
    return err(refused("rate-limited", "too many invitation attempts; try again in a minute"));
  }
  if (status >= 500) {
    // A plugin fault is not a decision about this invitation — even if the body
    // carries a code we know, a 5xx means the write may or may not have happened. It
    // is reported as an outage, never as a named refusal.
    return err({
      kind: "engine-failed",
      message: `the invitation engine failed: ${messageOf(body, String(status))}`,
    });
  }
  if (status < 200 || status >= 300) {
    const refusalMessage = messageOf(body, "the invitation was refused");
    const code = typeof body.code === "string" ? body.code : null;
    const mapped = code === null ? undefined : OUTCOME_BY_PLUGIN_CODE[code];
    // An unrecognised 4xx: `invalid-request` would tell a caller what to fix, which
    // we cannot know; `forbidden` is the honest, closed answer.
    if (mapped === undefined) return err(refused("forbidden", refusalMessage));
    return err(refused(mapped.code, refusalMessage, mapped.reason));
  }

  if (body.action === "SIGN_IN_REQUIRED") return ok({ status: "sign-in-required" });
  if (body.action === "ACCEPTED") {
    return ok({
      status: "redeemed",
      organizationId: organizationIdOf(body.organization),
      role: typeof body.role === "string" ? body.role : null,
      signedIn: body.signedIn === true,
    });
  }
  // A 2xx we do not understand is still not a redemption.
  return err(
    refused("forbidden", "the invitation engine answered something this route does not know"),
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
