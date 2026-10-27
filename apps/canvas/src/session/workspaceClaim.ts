import { credentialAuthorization } from "../auth/credential";
import { accountHttpBase } from "./endpoints";

/**
 * Putting a workspace into the account that made it.
 *
 * This is the moment a workspace stops being only local, and it is deliberately
 * silent: signing in and carrying on is the whole interaction. The answer is what
 * matters, because the control plane is the only place that knows whether the
 * plan covers another workspace — asking it here is what turns "this refuses to
 * sync and nobody knows why" into a badge with an upgrade link.
 */
export type ClaimOutcome =
  /** It is in the account now, or it already was. */
  | "claimed"
  /** This workspace belongs to a different organization. */
  | "elsewhere"
  /** The plan does not cover another workspace. It stays local, and that is allowed. */
  | "capped"
  /** No session, no server, or no answer. Worth retrying on the next boot. */
  | "unavailable";

export const CLAIM_PATH = "/api/workspaces/claim";

export interface ClaimInput {
  workspaceId: string;
  /** Sent as the workspace's name, so the account list is readable before it syncs. */
  name?: string;
  base?: string;
  fetch?: typeof globalThis.fetch;
  authorization?: () => Promise<Record<string, string>>;
}

export async function claimWorkspaceForAccount(input: ClaimInput): Promise<ClaimOutcome> {
  const call = input.fetch ?? globalThis.fetch;
  let headers: Record<string, string>;
  try {
    headers = await (input.authorization ?? credentialAuthorization)();
  } catch {
    // No session: nothing was asked of anyone, so nothing is wrong.
    return "unavailable";
  }
  if (Object.keys(headers).length === 0) return "unavailable";
  try {
    const response = await call(`${input.base ?? accountHttpBase()}${CLAIM_PATH}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    });
    if (response.ok) return "claimed";
    const body: unknown = await response.json().catch(() => null);
    const error =
      typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    if (error === "workspace-already-claimed") return "elsewhere";
    // Both allowances — workspaces and seats — arrive as one refusal, because
    // both mean the same thing to the person reading it: the plan is the obstacle.
    if (error === "seat-refused") return "capped";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
