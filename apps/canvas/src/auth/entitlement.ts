/**
 * What the account may use, and what to do when a refusal says it is not enough.
 *
 * The entitlement is not invented here: the relay's JWT carries `tier` and
 * `limits`, minted server-side from the subscription (ADR-0065 §…, ADR-0074,
 * ADR-0075). Reading the claims of the token this page already holds is therefore
 * the *authoritative* read, and it costs no request. `GET /api/auth/entitlement`
 * is not needed for a display, and this module never guesses a limit it was not
 * given.
 */

import { type CredentialClaims, currentCredentialClaims } from "./credential";

/** One line of the quota display. */
export interface QuotaLine {
  /** The relay's own limit name, so a mismatch is visible rather than silent. */
  id: string;
  label: string;
  /** The plan's allowance, in the unit the label names. */
  limit: number;
  /** How it reads in the panel: "10 workspaces", "2 GB", or "none yet". */
  value: string;
  /** True for an allowance the plan names and sets to zero. */
  zero: boolean;
}

/** Human names and units for the limits the relay enforces. Unknown ones still show. */
const LIMIT_LABELS: Readonly<Record<string, { label: string; unit: "count" | "bytes" }>> = {
  workspaces: { label: "Workspaces", unit: "count" },
  seats: { label: "Team members", unit: "count" },
  members: { label: "Team members", unit: "count" },
  boards: { label: "Boards per workspace", unit: "count" },
  cards: { label: "Cards per workspace", unit: "count" },
  documentBytes: { label: "Document storage", unit: "bytes" },
  attachmentBytes: { label: "Attachment storage", unit: "bytes" },
  storageBytes: { label: "Storage", unit: "bytes" },
};

function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[index]}`;
}

function prettify(id: string): string {
  const spaced = id.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/[-_]+/gu, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The plan's allowances as rows.
 *
 * A zero is shown, not hidden. Dropping it is how this panel came to tell a free
 * organization that the server "sets no limits": every entry was filtered out, the list
 * came back empty, and the empty case was described as unlimited. A plan that names an
 * allowance and sets it to zero is saying something, and the panel repeats it.
 */
export function quotaLines(
  limits: Readonly<Record<string, number>> | null | undefined,
): QuotaLine[] {
  if (!limits) return [];
  return Object.entries(limits)
    .filter(([, limit]) => typeof limit === "number" && Number.isFinite(limit) && limit >= 0)
    .map(([id, limit]) => {
      const known = LIMIT_LABELS[id];
      const unit = known?.unit ?? "count";
      return {
        id,
        label: known?.label ?? prettify(id),
        limit,
        value: limit === 0 ? "none yet" : unit === "bytes" ? humanBytes(limit) : String(limit),
        zero: limit === 0,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** The tier a hosted deployment gives an organization with no subscription. */
export const FREE_TIER_ID = "free";

/**
 * What a plan-less organization gets, said once.
 *
 * The free licence grants no synced workspace and no bytes on the server, so the panel
 * states that in one sentence and then offers the plans. Nothing local is capped by it:
 * workspaces live in IndexedDB on the device whether or not an account exists, which is
 * the product and not a consolation.
 */
export const FREE_PLAN_SENTENCE =
  "Everything on this device is uncapped. A plan adds the room: syncing, sharing and opening it elsewhere.";

/** The line a free tier shows, so the zero it carries is not invisible. */
export function freeWorkspaceLine(): QuotaLine {
  return { id: "workspaces", label: "Synced workspaces", limit: 0, value: "none yet", zero: true };
}

/** The account's plan, as the panel states it. `null` when no token is held yet. */
export interface EntitlementView {
  tier: string;
  organizationId: string | null;
  role: string | null;
  limits: Readonly<Record<string, number>>;
  quota: QuotaLine[];
  /** Epoch milliseconds the current credential expires; the limits refresh then. */
  refreshesAt: number | null;
}

export function entitlementView(claims: CredentialClaims | null): EntitlementView | null {
  if (claims === null) return null;
  return {
    tier: claims.tier,
    organizationId: claims.org,
    role: claims.role,
    limits: claims.limits,
    quota: quotaLines(claims.limits),
    refreshesAt: claims.expiresAt,
  };
}

/** The entitlement of the credential this page holds, if it holds one. */
export function currentEntitlement(): EntitlementView | null {
  return entitlementView(currentCredentialClaims());
}

/**
 * A refusal the client can act on.
 *
 * - `upgrade` — the plan is the obstacle: a seat, a workspace or a byte the tier
 *   does not cover. The reader can buy their way past it, so the prompt offers
 *   checkout.
 * - `quota` — the same obstacle seen through the local copy (this browser is
 *   full). Nothing to buy; the action is export or cleanup.
 * - `admission` — the account is on an operator's list. Waiting is the action.
 * - `other` — a permission or a bug; an upgrade prompt would be a lie.
 */
export type RefusalKind = "upgrade" | "quota" | "admission" | "other";

/** The refusal codes the relay and the control plane use for a plan limit. */
const UPGRADE_CODES: readonly string[] = [
  "seat-refused",
  "seat-limit",
  // An account with no plan at all. This is the hosted launch state: local and offline
  // use is free and needs no account, so an account exists to buy sync.
  "plan-required",
  "workspace-limit",
  "document-limit",
  "attachment-limit",
  "storage-limit",
  "licence-expired",
  "entitlement-required",
  "subscription-required",
];

export function refusalKind(code: string | null | undefined, status?: number): RefusalKind {
  const value = (code ?? "").trim().toLowerCase();
  if (value === "admission-pending") return "admission";
  if (UPGRADE_CODES.includes(value)) return "upgrade";
  // A payment-required status is the same message without a code.
  if (status === 402) return "upgrade";
  // The browser's own store refusing a write is not something to sell past.
  if (value === "quota-exceeded" || value === "quota") return "quota";
  return "other";
}

/** The sentence an upgrade prompt leads with, per refusal. */
export function upgradeMessage(code: string | null | undefined): string {
  const value = (code ?? "").trim().toLowerCase();
  if (value === "seat-refused" || value === "seat-limit") {
    return "This workspace's plan has no free seat left. Add a seat, or ask the owner to free one.";
  }
  if (value === "plan-required") {
    return "Syncing needs a plan. Everything in this workspace stays on this device until you pick one.";
  }
  if (value === "workspace-limit") {
    return "This plan's workspaces are all in use. Upgrade to create another one; nothing was deleted.";
  }
  if (value === "attachment-limit" || value === "storage-limit") {
    return "This plan's storage is full, so the file stayed on this device. Upgrade to sync it.";
  }
  if (value === "licence-expired" || value === "subscription-required") {
    return "The subscription behind this workspace has lapsed. Renew to keep syncing here.";
  }
  return "This works on a higher plan. Everything here is safe; upgrade when you are ready.";
}
