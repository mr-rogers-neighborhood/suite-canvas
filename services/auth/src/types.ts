/**
 * The types the control plane works in.
 *
 * Two deliberate shapes to note before reading further:
 *
 * 1. `OrganizationRole` is Better Auth's role set, not ours. ADR-0065's
 *    amendment makes Better Auth organizations the workspace, so inventing
 *    `owner | editor | viewer` here would create the second membership model
 *    the ADR forbids. `capabilities.ts` is the single place that maps roles to
 *    the app's nine capability flags.
 * 2. `LicenceClaims` is declared structurally rather than imported from
 *    `apps/collab-server/src/licence.ts`. A service importing from an app
 *    inverts the dependency order; structural typing keeps the contract (the
 *    relay passes real `LicenceClaims` straight in, and its test proves the
 *    two are assignable) without that import.
 */

/** Better Auth organization roles. Custom roles (`ac`) are deliberately unused. */
export const organizationRoles = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && (organizationRoles as readonly string[]).includes(value);
}

/** One `member` row of an organization: the seat, and the role it carries. */
export interface MemberRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: number;
}

/**
 * An organization as the control plane reads it. `workspaceId` is
 * `organization.slug` — the one field that can hold a pre-existing document id,
 * which is what lets a claim keep the workspace's identity (ADR-0065 §2).
 */
export interface WorkspaceRecord {
  /**
   * `organization.id` — the billing boundary, not the document id — or null for
   * an anonymous workspace (the local-first case, which no licence gates).
   */
  organizationId: string | null;
  workspaceId: string;
  name: string;
  createdAt: number;
  members: readonly MemberRecord[];
}

/**
 * The signed licence fields the seat check reads. Every field is signed by the
 * billing service and verified by the relay's Ed25519 check; nothing here may
 * ever come from a client body.
 */
export interface LicenceClaims {
  v: number;
  id: string;
  tier: string;
  workspaces: number;
  documentBytes: number;
  attachmentBytes: number;
  issuedAt: number;
  expiresAt: number;
  email?: string;
}

/**
 * A verified licence plus the seat count.
 *
 * `licence.ts` does not sign a seat count — it signs `workspaces` and the two
 * byte caps — so the seats are read from the licence row the control plane
 * stored (`organization_licences.seats`, see the SQL migration) instead of
 * being invented from the tier name. The default is 0, which fails closed: a
 * licence that never recorded a seat count admits its owner and nobody else.
 */
export interface SeatLicence {
  claims: LicenceClaims;
  seats: number;
}

/**
 * What a request resolved to, after precedence.
 *
 * `workspaceId` is always present: every principal names exactly one workspace,
 * and the relay compares it to the room it is joining.
 */
export type Principal =
  | {
      kind: "account";
      workspaceId: string;
      organizationId: string;
      userId: string;
      role: OrganizationRole;
    }
  | { kind: "owner"; workspaceId: string }
  | { kind: "share"; workspaceId: string };

/**
 * The slice of a Better Auth session the resolver needs.
 *
 * `workspaceId` is the workspace the session is *acting on*
 * (`session.activeOrganizationId` resolved to its slug) and `role` is that
 * organization's `member.role`. Both are read server-side; neither is trusted
 * from the body.
 */
export interface AccountSession {
  userId: string;
  /**
   * `session.activeOrganizationId`, or null when the session has no active
   * organization. Better Auth stores the *tenant* on the session, not a
   * workspace: an organization owns many documents (ADR-0065 amendment §1).
   */
  organizationId: string | null;
  /** That user's role in that organization, or null when membership is gone. */
  role: OrganizationRole | null;
  /**
   * When an operator admitted this account, or null while it waits. Read from the
   * user row on every session rather than cached on the session, so admitting
   * someone takes effect without asking them to sign in again.
   */
  admittedAt: number | null;
}

/** Everything the control plane reads from the environment, once per invocation. */
export interface AuthEnvironment {
  /** `1` or `true` turns the account service on. Anything else is the alpha default: off. */
  SUITE_AUTH_ENABLED: string | undefined;
  /** Better Auth's signing secret; at least 32 characters. */
  SUITE_AUTH_SECRET: string | undefined;
  /** Public origin the session cookie is scoped to. */
  SUITE_AUTH_URL: string | undefined;
  /** Postgres control plane. Document bytes never go here (ADR-0065 §9). */
  SUITE_AUTH_DATABASE_URL: string | undefined;
  SUITE_GOOGLE_CLIENT_ID: string | undefined;
  SUITE_GOOGLE_CLIENT_SECRET: string | undefined;
  /** From address for magic links. */
  SUITE_AUTH_EMAIL_FROM: string | undefined;
  /** WebAuthn relying-party identity for passkeys. */
  SUITE_AUTH_RP_ID: string | undefined;
  SUITE_AUTH_RP_NAME: string | undefined;
  /**
   * Organizations one account may own on this deployment. Not a licence field:
   * a licence attaches to an organization, so this is the tenant ceiling, and
   * the default of 1 is the product's "one tenant, many workspaces" shape.
   */
  SUITE_AUTH_MAX_ORGS_PER_USER: string | undefined;
  /**
   * Cloudflare Turnstile secret. Set it to put invisible captcha in front of the
   * sign-up routes; unset means no challenge, which is the self-host default and
   * the shape a test run should have (ADR-0067 §9).
   */
  SUITE_TURNSTILE_SECRET: string | undefined;
  /**
   * `1` or `true` makes every new account wait for admission
   * (ADR-0067 §7).
   * Off by default: a self-host with one user does not need a queue, and the
   * gate must never surprise a deployment that did not ask for it.
   */
  SUITE_ADMISSION_REQUIRED: string | undefined;
}
