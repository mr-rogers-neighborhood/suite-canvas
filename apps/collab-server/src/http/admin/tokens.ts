import { timingSafeEqual } from "node:crypto";

/**
 * Scoped operator credentials (ADR-0076's operator surface).
 *
 * One unscoped token was a single key to every route: a scraper that needed
 * `GET /metrics` held the same secret as the call that deletes a workspace. Two
 * scopes fix the blast radius without inventing an account system for the
 * operator:
 *
 * - `read` sees `/metrics`, the status, the room and share inventories and the
 *   workspace list.
 * - `mutate` does everything `read` does and may change state.
 *
 * Tokens stay configuration, not rows: the relay has no operator table, and a
 * token an operator can rotate by editing the environment is one they can
 * revoke without a migration. `SUITE_ADMIN_TOKEN` keeps both scopes, so an
 * existing deployment is unchanged; `SUITE_ADMIN_READ_TOKEN` is the new,
 * narrower one.
 */

export const ADMIN_TOKEN_ENV = "SUITE_ADMIN_TOKEN";
export const ADMIN_READ_TOKEN_ENV = "SUITE_ADMIN_READ_TOKEN";

export type AdminScope = "read" | "mutate";

/**
 * Who acted. A name, never a secret: nothing here is ever logged or returned
 * beyond this label, which is what an audit line can safely say.
 */
export interface AdminCredential {
  actor: string;
  scopes: readonly AdminScope[];
}

interface ConfiguredCredential extends AdminCredential {
  token: string;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Every configured operator token, in the order a request is matched against them. */
export function adminCredentials(env: NodeJS.ProcessEnv = process.env): ConfiguredCredential[] {
  const credentials: ConfiguredCredential[] = [];
  const full = env[ADMIN_TOKEN_ENV]?.trim() ?? "";
  if (full.length > 0) {
    credentials.push({ actor: "admin", scopes: ["read", "mutate"], token: full });
  }
  const readOnly = env[ADMIN_READ_TOKEN_ENV]?.trim() ?? "";
  // The same secret in both variables must not silently widen the read token.
  if (readOnly.length > 0 && readOnly !== full) {
    credentials.push({ actor: "admin-read", scopes: ["read"], token: readOnly });
  }
  return credentials;
}

/** True when the admin API is switched on at all. */
export function adminConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return adminCredentials(env).length > 0;
}

/**
 * The credential a presented bearer token names, or null. Every configured
 * token is compared in constant time and no early exit shortens the loop, so a
 * miss costs the same as a match.
 */
export function resolveAdminCredential(
  presented: string | null,
  env: NodeJS.ProcessEnv = process.env,
): AdminCredential | null {
  if (presented === null || presented.length === 0) return null;
  let matched: AdminCredential | null = null;
  for (const credential of adminCredentials(env)) {
    // `constantTimeEqual` is called for every token even after a match, so the
    // number of comparisons does not reveal which one matched.
    if (constantTimeEqual(presented, credential.token) && matched === null) {
      matched = { actor: credential.actor, scopes: credential.scopes };
    }
  }
  return matched;
}

/** The scope a method needs. Every non-read method mutates. */
export function scopeOfMethod(method: string): AdminScope {
  return method === "GET" || method === "HEAD" ? "read" : "mutate";
}

export function allows(credential: AdminCredential, scope: AdminScope): boolean {
  return credential.scopes.includes(scope);
}
