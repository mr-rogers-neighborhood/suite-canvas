import { AuthError } from "../http/errors.js";
import type { MemberRecord, OrganizationRole, WorkspaceRecord } from "../types.js";

/**
 * Claiming an anonymous workspace (ADR-0065 §2, amendment §2).
 *
 * The promise is narrow and absolute: **claiming never changes the document
 * id**. `workspaces.id` *is* the document id, so the row can only be inserted
 * with the id that already exists in the URL, the owner link and every share
 * link. Nothing in this module can rename it, and nothing in this module knows
 * what a card, a board or a share row is — the control plane has no document
 * access at all, so "claiming cannot disturb the work" is structural rather
 * than a promise to be careful.
 */

/** Longest workspace id we will mirror. The relay caps ids at 512 as well. */
const MAX_WORKSPACE_ID_LENGTH = 512;
const MAX_WORKSPACE_NAME_LENGTH = 200;

export interface WorkspaceIdentity {
  workspaceId: string;
  name: string | null;
}

/**
 * The storage contract for workspaces. Every method is a single statement or a
 * single transaction; `better-auth-memory.ts` implements it in process and the
 * Postgres implementation is the SQL in `sql/0001_control_plane.sql`, whose
 * statements are exported below so the two cannot drift silently.
 */
export interface WorkspaceRepository {
  /** The workspace and its organization's members, or null when unclaimed. */
  find: (workspaceId: string) => Promise<WorkspaceRecord | null>;
  /**
   * Assigns an unclaimed workspace to an organization, or returns the existing
   * row unchanged when it already belongs to that same organization.
   *
   * Returns `null` when the workspace already belongs to a *different*
   * organization — the conditional-write signal that the caller turns into
   * `workspace-already-claimed`. Never updates `id`, `name` or `created_at`.
   */
  claim: (input: {
    workspaceId: string;
    organizationId: string;
    name: string;
    now: number;
  }) => Promise<WorkspaceRecord | null>;
  /** Non-archived workspaces in one organization, for the licence ceiling. */
  countForOrganization: (organizationId: string) => Promise<number>;
}

/**
 * The exact claim statement, kept next to the code that depends on its
 * semantics. Insert-if-absent, and the conflict branch only fires when the row
 * is unowned or already ours, so:
 *
 * - the first claim inserts the row with the document id it was given;
 * - a second claim by the same organization updates nothing (`WHERE` excludes
 *   it, and it needs no update because the link is already right);
 * - a claim by a different organization matches no row and `RETURNING` is
 *   empty, which the repository reports as `null` → `workspace-already-claimed`.
 *
 * `archived_at` is deliberately untouched: claiming a workspace that was
 * archived stays archived, because the claim is about ownership, not about
 * resurrection.
 */
export const CLAIM_WORKSPACE_SQL = `INSERT INTO workspaces (id, organization_id, name, created_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id
  WHERE workspaces.organization_id IS NULL
RETURNING id, organization_id, name, created_at`;

/** The idempotent read a second claim takes before the write, and the conflict check. */
export const FIND_WORKSPACE_SQL = `SELECT id, organization_id, name, created_at, archived_at
FROM workspaces
WHERE id = $1`;

export const COUNT_ORGANIZATION_WORKSPACES_SQL = `SELECT COUNT(*) AS count
FROM workspaces
WHERE organization_id = $1 AND archived_at IS NULL`;

export interface ClaimInput {
  workspaceId: string;
  organizationId: string;
  /** Display name; defaults to the id so a claimed workspace is never unnamed. */
  name?: string | null;
  now: number;
}

export type ClaimOutcome =
  | { status: "claimed"; workspace: WorkspaceRecord; owner: MemberRecord | null }
  | { status: "unchanged"; workspace: WorkspaceRecord; owner: MemberRecord | null };

export function ownerOf(workspace: WorkspaceRecord): MemberRecord | null {
  return workspace.members.find((member) => member.role === "owner") ?? null;
}

export function memberOf(workspace: WorkspaceRecord, userId: string): MemberRecord | null {
  return workspace.members.find((member) => member.userId === userId) ?? null;
}

/** C0 and DEL: printable ids only, because an id ends up in URLs and log lines. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateWorkspaceIdentity(input: WorkspaceIdentity): string | null {
  const id = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  if (id.length === 0) return "a workspace id is required";
  if (id.length > MAX_WORKSPACE_ID_LENGTH) return "the workspace id is too long";
  // Control characters would survive into a URL and a log line; refuse them here
  // rather than at four other layers.
  if (hasControlCharacter(id)) return "the workspace id contains control characters";
  if (input.name !== null && input.name !== undefined) {
    if (typeof input.name !== "string") return "the workspace name must be text";
    if (input.name.length > MAX_WORKSPACE_NAME_LENGTH) return "the workspace name is too long";
  }
  return null;
}

/**
 * Claiming is idempotent and it never moves a workspace between organizations.
 *
 * The two questions are answered in this order, because they have different
 * answers for the same request shape:
 *
 * 1. already ours → `unchanged`, and *no write at all*. A retried claim (the
 *    browser retries on reconnect; `ownerKey.ts` has a backoff list for exactly
 *    that) must not touch `created_at`, `name`, or anything else.
 * 2. already someone else's → a named error. Two owners who disagree is the
 *    failure the whole phase exists to prevent, so it is never "last write
 *    wins" and never a silent success.
 */
export async function claimWorkspace(
  input: ClaimInput,
  deps: { workspaces: WorkspaceRepository },
): Promise<ClaimOutcome> {
  const problem = validateWorkspaceIdentity({
    workspaceId: input.workspaceId,
    name: input.name ?? null,
  });
  if (problem !== null) throw new AuthError("invalid-request", problem);

  const workspaceId = input.workspaceId.trim();
  const name = input.name?.trim() || workspaceId;

  const existing = await deps.workspaces.find(workspaceId);
  if (existing !== null && existing.organizationId !== null) {
    if (existing.organizationId === input.organizationId) {
      return { status: "unchanged", workspace: existing, owner: ownerOf(existing) };
    }
    throw new AuthError(
      "workspace-already-claimed",
      "this workspace already belongs to another organization",
    );
  }

  const claimed = await deps.workspaces.claim({
    workspaceId,
    organizationId: input.organizationId,
    name,
    now: input.now,
  });
  if (claimed === null) {
    // Lost the race: another organization created the row between the read and
    // the write. That is the same answer as finding it owned above.
    throw new AuthError(
      "workspace-already-claimed",
      "this workspace was claimed by another organization",
    );
  }
  // The invariant the whole feature rests on. Asserted rather than assumed,
  // because a repository that renames the row would silently break every link.
  if (claimed.workspaceId !== workspaceId) {
    throw new AuthError("invalid-request", "the repository changed the workspace id");
  }
  return { status: "claimed", workspace: claimed, owner: ownerOf(claimed) };
}

/** The role a principal holds in the organization that owns a workspace, if any. */
export function roleIn(workspace: WorkspaceRecord | null, userId: string): OrganizationRole | null {
  if (workspace === null) return null;
  return memberOf(workspace, userId)?.role ?? null;
}
