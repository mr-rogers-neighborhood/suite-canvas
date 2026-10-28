import type { AccountSession } from "@suite/auth";

/**
 * The one fact two route modules share: who is calling.
 *
 * The loader hands a module no arguments and loads each file on its own, because its
 * job is to survive a module being absent (`modules/index.ts`). Identity is the
 * exception to that isolation: the auth module owns the Better Auth instance, and the
 * operator routes have to ask that same instance who the session belongs to. Rather
 * than each route module booting its own identity stack — two pools, two migrators,
 * two answers to "is this person an operator" — `auth` publishes its session reader
 * here and `admin` reads it.
 *
 * The order is the contract: `MODULE_NAMES` loads `auth` before `admin`, so the reader
 * is set by the time the operator routes can serve a request. A deployment with no
 * auth module leaves it null, and the operator routes then answer
 * `admin-not-configured` — which is the honest read of "this process holds accounts but
 * cannot tell who they are".
 */

export type SessionReader = (
  headers: Record<string, string | undefined>,
) => Promise<AccountSession | null>;

let reader: SessionReader | null = null;

/** Called by the auth module once its instance exists. */
export function publishSessionReader(next: SessionReader): void {
  reader = next;
}

/** Read by any module that has to know who is calling; null when identity is off. */
export function sessionReader(): SessionReader | null {
  return reader;
}

/** Test seam: forget the published reader between cases. */
export function resetSessionReader(): void {
  reader = null;
}
