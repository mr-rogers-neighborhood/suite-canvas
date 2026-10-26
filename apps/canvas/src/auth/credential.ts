import { authClientBase } from "./endpoints";

/**
 * The room credential: a short-lived session JWT (ADR-0074, ADR-0076).
 *
 * The browser holds a Better Auth session cookie it cannot read, and this module
 * trades it for a signed token at `GET /api/auth/token`. The token is what the
 * relay accepts — on the websocket join and in the `Authorization` header — so
 * the cookie never leaves the HTTP surface and the relay never needs a database.
 *
 * The token lives five minutes (`RELAY_TOKEN_TTL_SECONDS`), and that TTL *is* the
 * revocation window: a removed seat or a lowered role stops working at the next
 * mint. So this module refreshes a minute early and re-mints on every room join,
 * rather than treating the token as something a page holds for its lifetime.
 *
 * Nothing here imports the Better Auth client: a plain `fetch` keeps the token
 * path out of the client chunk, and a deployment with no auth service simply
 * answers nothing (null), which every caller already has to handle.
 */

/** Better Auth's own mount, then the `jwt` plugin's mint. */
export const CREDENTIAL_PATH = "/token";

/** Mint this long before expiry, so a long join never presents a token that died. */
export const REFRESH_MARGIN_MS = 60_000;

const MINT_TIMEOUT_MS = 4_000;

/**
 * The claims the relay reads (ADR-0074). Every one is set server-side when the
 * token is minted; a field a client could set is a field the relay would trust.
 */
export interface CredentialClaims {
  sub: string;
  org: string | null;
  role: string | null;
  tier: string;
  /** What the plan allows, in the relay's own units. Never authoritative here. */
  limits: Readonly<Record<string, number>>;
  /** Expiry, in epoch milliseconds. */
  expiresAt: number;
}

interface Cached {
  token: string;
  expiresAt: number;
}

let cached: Cached | null = null;
let inflight: Promise<string | null> | null = null;

/**
 * Set when the deployment answered "there is no mint here" once.
 *
 * A self-host that runs only the relay has no account service, so
 * `GET /api/auth/token` is a 404 on every join. Asking once and remembering the
 * answer keeps a local-first session from firing a doomed request at every
 * reconnect, and keeps the browser console free of one 404 per gesture.
 */
let noMintEndpoint = false;

function decodeBase64Url(value: string): string | null {
  const normalised = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), "=");
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

/**
 * The token's payload, or `null` when it is not a JWT this build understands.
 * Decoded rather than verified on purpose: the signature is the relay's job, and
 * a browser check would only ever message a reader about a token the server
 * already refused.
 */
export function credentialClaims(token: string | null | undefined): CredentialClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = decodeBase64Url(parts[1] ?? "");
  if (payload === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.sub !== "string" || record.sub.length === 0) return null;
  if (typeof record.exp !== "number" || !Number.isFinite(record.exp)) return null;
  const limits: Record<string, number> = {};
  if (typeof record.limits === "object" && record.limits !== null) {
    for (const [name, value] of Object.entries(record.limits as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) limits[name] = value;
    }
  }
  return {
    sub: record.sub,
    org: typeof record.org === "string" && record.org.length > 0 ? record.org : null,
    role: typeof record.role === "string" && record.role.length > 0 ? record.role : null,
    tier: typeof record.tier === "string" && record.tier.length > 0 ? record.tier : "free",
    limits,
    expiresAt: record.exp * 1000,
  };
}

/** Whether a token still has enough life left to be worth presenting. */
export function credentialIsFresh(
  token: string | null | undefined,
  now = Date.now(),
  margin = REFRESH_MARGIN_MS,
): boolean {
  const claims = credentialClaims(token);
  return claims !== null && claims.expiresAt - margin > now;
}

/** The token this page already holds, if it is still fresh. Never triggers a mint. */
export function cachedCredential(now = Date.now()): string | null {
  if (cached === null) return null;
  if (!credentialIsFresh(cached.token, now)) {
    cached = null;
    return null;
  }
  return cached.token;
}

/** The claims of the token this page holds, for the account surfaces. */
export function currentCredentialClaims(now = Date.now()): CredentialClaims | null {
  return credentialClaims(cachedCredential(now));
}

/**
 * Drops the cached token. Sign-out, and between tests.
 *
 * The "no mint here" memory is cleared too: a sign-in can turn a deployment that
 * had no accounts into one that does, and a stale refusal would hide it.
 */
export function forgetCredential(): void {
  cached = null;
  inflight = null;
  noMintEndpoint = false;
}

export interface MintCredentialInput {
  /** Better Auth's mount, normally from {@link authClientBase}. */
  base?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => number;
}

async function mintCredential(input: MintCredentialInput): Promise<string | null> {
  const base = input.base ?? authClientBase();
  const send = input.fetch ?? globalThis.fetch;
  if (typeof send !== "function") return null;
  if (noMintEndpoint) return null;
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), input.timeoutMs ?? MINT_TIMEOUT_MS)
    : null;
  try {
    const response = await send(`${base}${CREDENTIAL_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
      // The session cookie is httpOnly; it travels because this is a request,
      // and it is never read by script.
      credentials: "include",
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) {
      // 404 is the documented "accounts do not exist in this deployment" answer,
      // so stop asking. 401 is a signed-out person, which a later sign-in fixes.
      if (response.status === 404) noMintEndpoint = true;
      return null;
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const token = (body as { token?: unknown }).token;
    if (typeof token !== "string" || token.length === 0) return null;
    const claims = credentialClaims(token);
    // A token this build cannot read is a token it cannot refresh: treat the
    // mint as failed rather than presenting something of unknown age.
    if (claims === null) return null;
    const now = input.now?.() ?? Date.now();
    cached = { token, expiresAt: claims.expiresAt };
    return credentialIsFresh(token, now) ? token : null;
  } catch {
    // No server, no session, no network, no time: all of them are "no token".
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * A token fit to present right now, minting one when the cache cannot answer.
 *
 * One mint is in flight at a time: a boot that opens three rooms must not turn
 * into three requests. A failure resolves `null` and clears the cache, so the
 * next join tries again instead of holding a token the server has retired.
 */
export async function relayCredential(input: MintCredentialInput = {}): Promise<string | null> {
  const fresh = cachedCredential();
  if (fresh !== null) return fresh;
  inflight ??= mintCredential(input).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** The credential as the sync transport wants it: bytes, or nothing to present. */
export async function relayCredentialBytes(): Promise<Uint8Array | null> {
  const token = await relayCredential();
  return token === null ? null : new TextEncoder().encode(token);
}

/** Why a caller had no credential, in the words a reader can act on. */
export const NO_CREDENTIAL_MESSAGE =
  "This browser has no account session, so the server cannot be reached. Sign in and try again; nothing was changed.";

/** `Authorization` for one relay call. Throws rather than sending an anonymous request. */
export async function credentialAuthorization(): Promise<Record<string, string>> {
  const token = await relayCredential();
  if (token === null) throw new Error(NO_CREDENTIAL_MESSAGE);
  return { authorization: `Bearer ${token}` };
}
