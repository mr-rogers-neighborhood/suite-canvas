/**
 * Entitlement: what an organization's subscription buys, as the token reports it
 * (ADR-0075).
 *
 * The reader is injected because the row it reads is written by billing, and billing
 * arrives on its own schedule. Until it lands, `noEntitlements` answers for everyone:
 * tier `free`, no paid limits.
 *
 * The port is keyed by organization rather than by session because that is what the
 * subscription row is keyed by, and because a session without an organization is a
 * customer of nothing: `relayClaims` answers `freeEntitlement` for it without asking.
 */

export const FREE_TIER = "free";

/** The signed fields the relay enforces; a limit it does not read is not a limit. */
export interface Entitlement {
  tier: string;
  limits: Readonly<Record<string, number>>;
}

export interface EntitlementReader {
  forOrganization: (organizationId: string) => Promise<Entitlement>;
}

/** No subscription, no organization: the answer a self-hosted deployment gets. */
export const freeEntitlement: Entitlement = { tier: FREE_TIER, limits: {} };

/**
 * The placeholder reader. Swapped for the billing plugin's subscription lookup when
 * `services/billing` lands; the token format does not change with it.
 */
export const noEntitlements: EntitlementReader = {
  forOrganization: async () => freeEntitlement,
};
