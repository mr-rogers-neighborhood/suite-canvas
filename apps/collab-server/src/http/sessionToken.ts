import type { OrganizationRole } from "@suite/auth";
import {
  createRemoteJWKSet,
  customFetch,
  type FetchImplementation,
  jwtVerify,
  type RemoteJWKSet,
} from "jose";

/**
 * The relay's session credential (ADR-0074).
 *
 * The control plane signs a short-lived session JWT through Better Auth's `jwt()`
 * plugin and publishes the key set at `/api/auth/jwks`. This module verifies one
 * against a *cached* copy of that set: no identity table, no Postgres pool, and
 * no control-plane call per connection or per message. The only network call is a
 * key-set fetch, and only when the cache is cold or a key id is unknown.
 *
 * A verification failure is a refusal. Nothing here falls back to another
 * credential: the caller decides what an unverified join means, and the answer
 * is always "no room".
 */

/** Where `SUITE_AUTH_URL` publishes the key set. Better Auth owns the prefix. */
export const JWKS_PATH = "/api/auth/jwks";

/** How long a fetched key set is reused before a missing key triggers a refetch. */
export const JWKS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * How long after a fetch an unknown `kid` is refused instead of refetched.
 *
 * The cooldown is what keeps a forged `kid` from turning every join into a
 * control-plane request, and it is also the worst-case window in which a key
 * rotation refuses a brand-new `kid`. Five seconds buys a rotation that heals
 * almost immediately for the price of at most twelve small GETs a minute.
 */
export const JWKS_COOLDOWN_MS = 5 * 1000;

/** Hard limit on one key-set fetch; a hung control plane must not hang a join. */
export const JWKS_TIMEOUT_MS = 5 * 1000;

/**
 * Slack on `exp` / `iat`, for a relay whose clock and the control plane's differ.
 * Small on purpose: the TTL is the revocation window, so a generous skew
 * stretches it silently.
 */
export const SESSION_CLOCK_TOLERANCE_SECONDS = 30;

/** Exactly the claims the relay reads; everything else in the token is ignored. */
export interface SessionClaims {
  /** `sub`: the account id. */
  userId: string;
  /** `org`: the organization the session is acting in, or null for a personal one. */
  organizationId: string | null;
  /** `role`: the account's role in that organization, or null when it has none. */
  role: OrganizationRole | null;
  /** `tier`: the plan name the organization's subscription buys. */
  tier: string;
  /** `limits`: the caps that tier carries. Absent on the free tier. */
  limits: Readonly<Record<string, number>>;
  /** Epoch milliseconds from `iat`. */
  issuedAt: number;
  /** Epoch milliseconds from `exp`. */
  expiresAt: number;
  /**
   * True when the deployment named this account a platform operator.
   *
   * Distinct from `role`, which is the account's role *inside* the organization the
   * session acts in: an organization owner is not an operator of the deployment. Only
   * `/api/admin` reads this, and it is minted from `SUITE_ADMIN_EMAILS` on the control
   * plane, so it cannot be claimed by a client.
   */
  operator: boolean;
}

/**
 * The roles a token may carry. Spelled out rather than imported from the control
 * plane's guard, because the package root does not export one and the relay must
 * not deep-import another service's internals; a role outside this set is a
 * claim this build does not understand, and an unrecognised role is refused.
 */
const ORGANIZATION_ROLES: readonly OrganizationRole[] = ["owner", "admin", "member"];

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export type SessionRefusal = "malformed" | "signature" | "expired" | "claims";

export type SessionResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: SessionRefusal };

export interface SessionVerifier {
  /** Verifies one bearer token. Never throws: a refusal is a value. */
  verify: (token: string) => Promise<SessionResult>;
  /** Fetches the key set now, bypassing the cooldown. For startup and tests. */
  refresh: () => Promise<void>;
}

export interface SessionVerifierOptions {
  /** `SUITE_AUTH_URL`: the issuer, the audience and the origin of the key set. */
  authUrl: string;
  now?: () => number;
  /** Cache lifetime in milliseconds; defaults to {@link JWKS_CACHE_MAX_AGE_MS}. */
  cacheMaxAge?: number;
  /** Unknown-`kid` refetch cooldown; defaults to {@link JWKS_COOLDOWN_MS}. */
  cooldown?: number;
  /** Fetch timeout; defaults to {@link JWKS_TIMEOUT_MS}. */
  timeout?: number;
  /** Replacement for `fetch`, so a test can serve a key set without a socket. */
  fetch?: FetchImplementation;
}

/**
 * Trims and de-strokes a configured auth origin. Better Auth mints `iss` and
 * `aud` from the value an operator set, so the relay compares the same string;
 * a trailing slash is the one difference people introduce by hand.
 */
export function normaliseAuthUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/** A compact JWS is three base64url segments; anything else is not worth a fetch. */
export function looksLikeSessionToken(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function limitsOf(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const limits: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) limits[key] = raw;
  }
  return limits;
}

/** Narrows a verified payload to the claims the relay reads, or null. */
export function sessionClaimsOf(payload: Record<string, unknown>): SessionClaims | null {
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (subject.length === 0) return null;

  const organization = payload.org;
  if (organization !== null && typeof organization !== "string") return null;
  const organizationId =
    typeof organization === "string" && organization.trim().length > 0 ? organization.trim() : null;

  const role = payload.role;
  if (role !== null && !isOrganizationRole(role)) return null;

  const tier = typeof payload.tier === "string" ? payload.tier.trim() : "";
  if (tier.length === 0) return null;

  // `jwtVerify` has already checked `exp` and `iat`; this only converts them.
  const expiresAt = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  const issuedAt = typeof payload.iat === "number" ? payload.iat * 1000 : 0;

  return {
    userId: subject,
    organizationId,
    role: role === null ? null : (role as OrganizationRole),
    tier,
    limits: limitsOf(payload.limits),
    issuedAt,
    expiresAt,
    // Anything but a literal `true` is not an operator: a claim this build does not
    // understand must not widen a door.
    operator: payload.operator === true,
  };
}

/**
 * The verifier a deployment with no control plane gets: it refuses every token.
 *
 * Refusing is the only honest answer — there is no key set to check a signature
 * against — and it keeps the HTTP routes' shape identical on a self-host, where
 * an account is simply not a way in.
 */
export const noSessionVerifier: SessionVerifier = {
  verify: async () => ({ ok: false, reason: "malformed" }),
  refresh: async () => {
    // Nothing is cached, so there is nothing to refresh.
  },
};

export function createSessionVerifier(options: SessionVerifierOptions): SessionVerifier {
  const issuer = normaliseAuthUrl(options.authUrl);
  if (issuer === null) throw new Error("SUITE_AUTH_URL must be an http or https URL.");

  const keys: RemoteJWKSet = createRemoteJWKSet(new URL(JWKS_PATH, issuer), {
    cacheMaxAge: options.cacheMaxAge ?? JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: options.cooldown ?? JWKS_COOLDOWN_MS,
    timeoutDuration: options.timeout ?? JWKS_TIMEOUT_MS,
    ...(options.fetch === undefined ? {} : { [customFetch]: options.fetch }),
  });

  const now = options.now ?? Date.now;

  return {
    refresh: async () => {
      await keys.reload();
    },

    verify: async (token) => {
      if (!looksLikeSessionToken(token)) return { ok: false, reason: "malformed" };

      let payload: Record<string, unknown>;
      try {
        const verified = await jwtVerify(token, keys, {
          issuer,
          audience: issuer,
          clockTolerance: SESSION_CLOCK_TOLERANCE_SECONDS,
        });
        payload = verified.payload as Record<string, unknown>;
      } catch (error) {
        // `jose` reports the reason in the error code; the token itself is never
        // logged, so a refusal names a class of failure and nothing else.
        const code = (error as { code?: string }).code ?? "";
        if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
        // A missing key id inside the cooldown lands here too: the relay cannot
        // check the signature either way, so it reports the same class.
        if (
          code.startsWith("ERR_JWS") ||
          code.startsWith("ERR_JWKS") ||
          code.startsWith("ERR_JWT_CLAIM")
        ) {
          return { ok: false, reason: "signature" };
        }
        return { ok: false, reason: "malformed" };
      }

      const claims = sessionClaimsOf(payload);
      if (claims === null) return { ok: false, reason: "claims" };
      // A token that verifies is used only while it is live; `exp` is checked by
      // `jwtVerify`, and this keeps a clock that jumped backwards honest.
      if (claims.expiresAt !== 0 && claims.expiresAt <= now()) {
        return { ok: false, reason: "expired" };
      }
      return { ok: true, claims };
    },
  };
}
