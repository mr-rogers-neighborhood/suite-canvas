import type { SessionVerifier } from "../sessionToken.js";

/**
 * Who may use the operator surface (ADR-0076, amended).
 *
 * The door used to be one or two bearer tokens in the environment. A token has two
 * flaws that matter more as the surface grows: it cannot be revoked without a restart,
 * and an audit line can only say "admin" rather than which person acted. The relay
 * already verifies the control plane's session JWT on every join (ADR-0074), so the
 * same verification now answers this question too — the token the browser already
 * holds, checked against the same key set, and refused unless the account is one the
 * deployment named as an operator.
 *
 * Two scopes remain, because they describe the blast radius rather than the identity:
 *
 * - `read` sees `/metrics`, the status, the room and share inventories and the
 *   workspace list.
 * - `mutate` does everything `read` does and may change state.
 *
 * An operator holds both. The split stays because a scrape-only client should stay a
 * scrape-only client, and because it is what lets a future role be narrower than
 * "operator" without rewriting a single handler.
 */

export type AdminScope = "read" | "mutate";

/**
 * Who acted. The account id, never a secret: nothing here is ever logged or returned
 * beyond this label, and it is what makes an audit line name a person.
 */
export interface AdminCredential {
  actor: string;
  scopes: readonly AdminScope[];
}

/**
 * Whether this deployment has an operator surface at all.
 *
 * `SUITE_AUTH_URL` is the whole answer: without a control plane there is no key set to
 * verify a session against, so there is nobody who could be an operator, and the routes
 * answer 404 rather than 401. Refusing is the honest read of "this server has no
 * identity to check".
 */
export function adminConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SUITE_AUTH_URL ?? "").trim().length > 0;
}

/**
 * The credential a presented session token names, or null.
 *
 * A valid signature is not enough: the token also has to carry `operator: true`, which
 * the control plane mints from `SUITE_ADMIN_EMAILS`. An organization owner's token is a
 * perfectly good session and is still refused here, because owning a tenant is not
 * operating the deployment.
 */
export async function resolveAdminCredential(
  presented: string | null,
  verifier: SessionVerifier,
): Promise<AdminCredential | null> {
  if (presented === null || presented.length === 0) return null;
  const result = await verifier.verify(presented);
  if (!result.ok) return null;
  if (!result.claims.operator) return null;
  return { actor: `account:${result.claims.userId}`, scopes: ["read", "mutate"] };
}

/**
 * The scope a method needs and the scopes it must not exceed.
 *
 * Every non-read method mutates; a read-only credential is refused one. The relay
 * never mints a read-only operator today, so this is the shape a narrower role would
 * arrive in rather than a branch anybody can reach.
 */
export function scopeOfMethod(method: string): AdminScope {
  return method === "GET" || method === "HEAD" ? "read" : "mutate";
}

export function allows(credential: AdminCredential, scope: AdminScope): boolean {
  return credential.scopes.includes(scope);
}
