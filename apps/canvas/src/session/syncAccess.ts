import { credentialAuthorization } from "../auth/credential";
import type { SyncRefusal } from "../feedback/syncState";
import { collabHttpBase } from "./endpoints";

/**
 * Why the relay would refuse this browser, asked directly.
 *
 * The socket carries one word for every refusal — "authentication failed" — which
 * is how a session that ended, a plan that lapsed and a workspace that belongs to
 * somebody else came to read as the same alarming sentence. The relay answers
 * this route with the reason, so the panel can say something true.
 *
 * The route is read-only by construction: asking must not record a claim.
 */
export const ACCESS_PATH = "/api/workspaces";

export interface AccessInput {
  workspaceId: string;
  base?: string;
  fetch?: typeof globalThis.fetch;
  authorization?: () => Promise<Record<string, string>>;
}

/** The relay's own names, narrowed to the four a reader can act on. */
const REFUSAL: Readonly<Record<string, SyncRefusal>> = {
  "no-credential": "session",
  "session-invalid": "session",
  "organization-required": "unknown",
  "not-a-capability": "unknown",
  "licence-unprovisioned": "plan",
  "licence-missing": "plan",
  "licence-expired": "plan",
  "workspace-owned-elsewhere": "elsewhere",
};

/**
 * The reason, or null when there is nothing to report: no session, no server, or
 * an answer this build does not understand. Silence is better than a guess here —
 * the panel already has a sentence for "cannot sync right now".
 */
export async function readSyncRefusal(input: AccessInput): Promise<SyncRefusal | null> {
  const call = input.fetch ?? globalThis.fetch;
  let headers: Record<string, string>;
  try {
    headers = await (input.authorization ?? credentialAuthorization)();
  } catch {
    return null;
  }
  if (Object.keys(headers).length === 0) return null;
  try {
    const response = await call(
      `${input.base ?? collabHttpBase()}${ACCESS_PATH}/${encodeURIComponent(input.workspaceId)}/access`,
      {
        method: "GET",
        headers: { ...headers, accept: "application/json" },
        credentials: "include",
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { ok, reason } = body as { ok?: unknown; reason?: unknown };
    if (ok === true) return null;
    return typeof reason === "string" ? (REFUSAL[reason] ?? "unknown") : null;
  } catch {
    return null;
  }
}
