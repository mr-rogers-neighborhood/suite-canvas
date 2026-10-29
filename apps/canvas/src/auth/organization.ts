/**
 * The tenant an account acts in.
 *
 * A workspace belongs to an organization, a member row carries the role, and a
 * subscription is bought by the organization (ADR-0065, ADR-0077). So almost every
 * account surface starts here: find the organization this session is acting in,
 * creating the account's first one when it has none.
 *
 * `POST /organization/create` is one of the paths an operator's admission switch
 * can refuse, which is how a held account learns it is waiting — the client never
 * infers admission from a null field.
 */

import { authClient, readSession } from "./client";

/** The tenant name for an account that is getting its first organization. */
export const ORGANIZATION_NAME = "My workspaces";

export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string | null;
  role: OrganizationRole | null;
}

export type OrganizationAnswer =
  | { ok: true; organizationId: string }
  | { ok: false; code: string; message: string };

/** The refusal code, in the spellings the client acts on. */
export function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    const status = (error as { status?: unknown }).status;
    if (status === 401) return "unauthorized";
    if (status === 403) return "forbidden";
    if (status === 402) return "subscription-required";
    if (status === 503) return "auth-not-configured";
  }
  return "unreachable";
}

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  return fallback;
}

/** The organizations this account belongs to, newest first by the server's order. */
export async function listOrganizations(): Promise<OrganizationSummary[]> {
  try {
    const listed = await authClient.organization.list();
    if (listed.error || !Array.isArray(listed.data)) return [];
    return listed.data.flatMap((entry): OrganizationSummary[] => {
      const id = typeof entry.id === "string" ? entry.id : null;
      if (id === null) return [];
      return [
        {
          id,
          name: typeof entry.name === "string" ? entry.name : ORGANIZATION_NAME,
          slug: typeof entry.slug === "string" ? entry.slug : null,
          role: null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * The organization a claim or a checkout lands in, creating the account's first
 * one if it has none. A refusal carries the server's code, so the caller can tell
 * "waiting for admission" from "this account may not".
 *
 * The session's **active** organization always wins, and a choice made here is made active
 * before it is returned. That is the whole point: the relay enforces the organization in
 * the session token, so a panel that read one organization while the token named another
 * showed a paid plan beside "your plan does not cover this workspace". An account can hold
 * more than one organization (a comped one, a second personal one, an organization it was
 * invited into), and nothing else decides which of them a request acts in.
 */
export async function ensureOrganization(
  displayName: string = ORGANIZATION_NAME,
): Promise<OrganizationAnswer> {
  try {
    const session = await readSession();
    if (session === null) {
      // No session, so no organization to act in. Creating one is the account surface's
      // job, and it is reached by making an account.
      return {
        ok: false,
        code: "unauthorized",
        message: "A plan belongs to an account. Make one first.",
      };
    }
    if (session.activeOrganizationId !== null) {
      return { ok: true, organizationId: session.activeOrganizationId };
    }
    const listed = await authClient.organization.list();
    if (!listed.error && Array.isArray(listed.data)) {
      const existing = listed.data[0];
      if (existing?.id) {
        // Unset is not decided: whatever this returns becomes the tenant this page acts
        // in, so it is set rather than assumed.
        await setActiveOrganization(existing.id);
        return { ok: true, organizationId: existing.id };
      }
    }
    const slug = `personal-${crypto.randomUUID().slice(0, 12)}`;
    const created = await authClient.organization.create({ name: displayName, slug });
    if (created.error || !created.data?.id) {
      return {
        ok: false,
        code: codeOf(created.error),
        message: messageOf(created.error, "This account could not open a workspace space yet."),
      };
    }
    // A brand new organization is not the session's tenant until it is said to be, and
    // every request after this one reads the session.
    await setActiveOrganization(created.data.id);
    return { ok: true, organizationId: created.data.id };
  } catch {
    return {
      ok: false,
      code: "unreachable",
      message: "The account service did not answer, so nothing changed.",
    };
  }
}

/** Switches the session's active organization; every later request acts in it. */
export async function setActiveOrganization(organizationId: string): Promise<boolean> {
  try {
    const result = await authClient.organization.setActive({ organizationId });
    return !result.error;
  } catch {
    return false;
  }
}
