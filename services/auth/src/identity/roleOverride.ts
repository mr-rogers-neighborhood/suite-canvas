import type { MembershipReader } from "../licensing/licences.js";
import type { OrganizationRole } from "../types.js";

/**
 * Wearing a role, for the operator who has to see what a member sees.
 *
 * The product has three organization roles and one of them (`owner`) is the only one that
 * can hold a licence; an operator testing "what does a member lose" otherwise needs a second
 * account in a second organization, which is the sort of fixture that rots. So an operator
 * may *wear* a role: the member row is untouched, and the role this process reports for them
 * is the worn one while it lasts.
 *
 * ## One lookup, both answers
 *
 * Everything that asks "what role is this person in this organization" asks
 * `MembershipReader.roleFor` — the session the app loads and the token the relay verifies.
 * Wrapping that one reader is why the two cannot disagree: an override that reached the
 * session but not the token would show a member's buttons and keep an owner's powers.
 *
 * ## What it deliberately does not reach
 *
 * Spending money. The billing plugin checks the membership row itself, so a worn owner
 * cannot start a checkout; the panel says so rather than failing. A role is a set of
 * capabilities inside a workspace, and money is asked of the tenant, not the costume.
 */
export type RoleOverrideLookup = (input: {
  userId: string;
  organizationId: string;
  /** The real role, so a reader can decide whether there is anything to override. */
  role: OrganizationRole | null;
}) => Promise<OrganizationRole | null>;

/** The real reader, with its `roleFor` answer replaced while an override is live. */
export function withRoleOverride(
  base: MembershipReader,
  lookup: RoleOverrideLookup,
): MembershipReader {
  return {
    countForOrganization: (organizationId) => base.countForOrganization(organizationId),
    countForUser: (userId) => base.countForUser(userId),
    listForOrganization: (organizationId) => base.listForOrganization(organizationId),
    roleFor: async (organizationId, userId) => {
      const real = await base.roleFor(organizationId, userId);
      const worn = await lookup({ userId, organizationId, role: real });
      return worn ?? real;
    },
  };
}
