import { credentialAuthorization } from "../auth/credential";
import { authServiceBase } from "../auth/endpoints";

/**
 * The role this browser is wearing, if any.
 *
 * An operator may put on another organization role to see what that role's canvas looks
 * like. The row lives on the control plane and is wrapped around the memberships reader
 * there, so this read is the same answer the session and the relay's token already got —
 * the strip exists because a capability that quietly changed is worse than one announced.
 *
 * A build with no account service answers "nothing worn" rather than failing: the strip is
 * an explanation, not a feature.
 */
export type WornRole = "owner" | "admin" | "member";

export interface WornRoleState {
  role: WornRole | null;
  organizationId: string | null;
  realRole: WornRole | null;
}

const NONE: WornRoleState = { role: null, organizationId: null, realRole: null };

export async function readWornRole(): Promise<WornRoleState> {
  if (import.meta.env.VITE_SUITE_MODE === "standalone") return NONE;
  let authorization: Record<string, string> = {};
  try {
    authorization = await credentialAuthorization();
  } catch {
    return NONE;
  }
  const response = await fetch(`${authServiceBase()}/api/account/role-override`, {
    headers: { ...authorization },
    credentials: "include",
  });
  if (!response.ok) return NONE;
  const body = (await response.json()) as Partial<WornRoleState>;
  return {
    role: body.role ?? null,
    organizationId: body.organizationId ?? null,
    realRole: body.realRole ?? null,
  };
}
