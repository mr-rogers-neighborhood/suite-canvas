import type { OrganizationRole } from "../types.js";

/**
 * What happens to an anonymous account's work when it signs up for real
 * (ADR-0067 §8).
 *
 * Better Auth's `anonymous` plugin calls `onLinkAccount` **before** it deletes the
 * anonymous user, which is the only window in which the rows still name someone.
 * This module is what runs in that window.
 *
 * **It adopts the organization; it does not move the workspaces.** Moving rows
 * would rewrite `organization_id` on every document — the column the licence
 * ceiling counts — so a reader who tried the product on a big trial could be
 * refused their own work for exceeding a ceiling they never chose. Adopting keeps
 * every id, URL and share link exactly where it was, and costs one `member` row.
 *
 * **Only organizations the anonymous account owns are adopted.** Being a plain
 * member of somebody else's organization is not something an anonymous account can
 * hand to a new one, and a transfer that swept those up would be a privilege
 * escalation dressed as a convenience.
 */

export interface AdoptionStore {
  /** Every organization this user has a `member` row in. */
  organizationsForUser: (userId: string) => Promise<readonly string[]>;
  roleFor: (organizationId: string, userId: string) => Promise<OrganizationRole | null>;
  addMember: (input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    now: number;
  }) => Promise<void>;
  /** Removes one membership. The user row itself is deleted by Better Auth. */
  removeMember: (input: { organizationId: string; userId: string }) => Promise<void>;
}

export interface AdoptionOutcome {
  /** Organizations the new account now owns because the anonymous one did. */
  adopted: readonly string[];
  /** Organizations it was already a member of, so nothing was written. */
  alreadyMember: readonly string[];
}

export interface AdoptionInput {
  fromUserId: string;
  toUserId: string;
  now: number;
}

export async function adoptAnonymousOrganizations(
  store: AdoptionStore,
  input: AdoptionInput,
): Promise<AdoptionOutcome> {
  const { fromUserId, toUserId, now } = input;
  if (fromUserId === toUserId) return { adopted: [], alreadyMember: [] };

  const organizations = await store.organizationsForUser(fromUserId);
  const adopted: string[] = [];
  const alreadyMember: string[] = [];

  for (const organizationId of organizations) {
    // Only what the anonymous account actually owned.
    if ((await store.roleFor(organizationId, fromUserId)) !== "owner") continue;

    if ((await store.roleFor(organizationId, toUserId)) !== null) {
      // Signing up twice in the same window is harmless: the work is already theirs.
      alreadyMember.push(organizationId);
      continue;
    }

    await store.addMember({ organizationId, userId: toUserId, role: "owner", now });
    adopted.push(organizationId);
  }

  // Explicitly, so the seat count is honest the moment the link completes rather
  // than whenever Better Auth's delete reaches the same table.
  for (const organizationId of adopted) {
    await store.removeMember({ organizationId, userId: fromUserId });
  }

  return { adopted, alreadyMember };
}
