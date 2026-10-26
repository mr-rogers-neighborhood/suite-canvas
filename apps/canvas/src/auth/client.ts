import { magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { authClientBase, claimWorkspaceUrl } from "./endpoints";
import { type PasskeyRequestOptions, signInWithPasskey } from "./passkey";
import {
  readLastLoginMethod,
  type SignInActions,
  type SignInMethod,
  type SignInResult,
} from "./signIn";

/**
 * The Better Auth client, and the only module that talks to it.
 *
 * Everything that renders takes actions as props, so a component test needs no
 * network and no server: this file is where the real transport lives, and it is
 * deliberately small.
 *
 * Plugins are the two this surface actually uses — `magicLinkClient` for
 * `signIn.magicLink` and `organizationClient` to find (or create) the tenant a
 * claim lands in. `anonymousClient` is *not* wired here: minting an anonymous
 * session on every local device would change the anonymous path this lane must
 * leave exactly as it is ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §8),
 * and the claim route already carries the work an anonymous account would.
 * `lastLoginMethod` needs no client plugin either: the server plugin records the
 * method in a readable cookie, and `readLastLoginMethod` parses that cookie
 * directly instead of pulling in a client plugin that only reads it.
 */

function clientBase(): string {
  const base = authClientBase();
  if (base.startsWith("/")) {
    // No browser (a test importing the module): Better Auth wants an absolute URL.
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    return `${origin}${base}`;
  }
  return base;
}

export const authClient = createAuthClient({
  baseURL: clientBase(),
  plugins: [magicLinkClient(), organizationClient()],
  // A self-hosted auth service is another origin; the session cookie has to travel.
  fetchOptions: { credentials: "include" },
});

/** Where to come back to: the sign-in page is the page the reader was on. */
function returnUrl(): string {
  return typeof window === "undefined" ? "" : window.location.href;
}

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

/** The last method that worked, for "continue with your passkey". */
export function lastUsedMethod(): SignInMethod | null {
  return readLastLoginMethod(typeof document === "undefined" ? null : document.cookie);
}

async function passkeyRequestOptions(): Promise<PasskeyRequestOptions | null> {
  try {
    const response = await fetch(`${authClientBase()}/passkey/generate-authenticate-options`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") return null;
    const options = body as Partial<PasskeyRequestOptions>;
    return typeof options.challenge === "string" ? (options as PasskeyRequestOptions) : null;
  } catch {
    return null;
  }
}

/** Magic link, Google, and the passkey ceremony — the three ways in (ADR §11). */
export const signInActions: SignInActions = {
  passkey: () =>
    signInWithPasskey({
      requestOptions: passkeyRequestOptions,
      verify: async (assertion) => {
        try {
          const response = await fetch(`${authClientBase()}/passkey/verify-authentication`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ response: assertion }),
          });
          if (response.ok) return { ok: true };
          const body: unknown = await response.json().catch(() => null);
          return { ok: false, message: messageOf(body, "That passkey was not accepted.") };
        } catch {
          return { ok: false, message: "The account service did not answer." };
        }
      },
    }),

  magicLink: async (email): Promise<SignInResult> => {
    try {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: returnUrl() });
      if (error) return { ok: false, message: messageOf(error, "That link could not be sent.") };
      return { ok: true, message: `Check ${email.trim()} for the link. It signs this device in.` };
    } catch {
      return { ok: false, message: "The account service did not answer." };
    }
  },

  google: async (): Promise<SignInResult> => {
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: returnUrl(),
      });
      if (error)
        return { ok: false, message: messageOf(error, "Google sign-in is not available here.") };
      // A redirect is in flight; nothing else to say.
      return { ok: true, message: "Taking you to Google…" };
    } catch {
      return { ok: false, message: "The account service did not answer." };
    }
  },
};

/** Ends the session. The workspace on this device is untouched. */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // A dead server must not trap someone in a session: forgetting it here is
    // still the honest thing, because the cookie will expire on its own.
  }
}

/**
 * The organization a claim lands in, creating the account's first one if it has
 * none. `POST /organization/create` is one of the three admission-gated paths, so
 * a held account is refused here — which is how the client learns it is waiting.
 */
export async function ensureOrganization(
  displayName: string,
): Promise<{ ok: true; organizationId: string } | { ok: false; code: string }> {
  try {
    const listed = await authClient.organization.list();
    if (!listed.error && Array.isArray(listed.data)) {
      const existing = listed.data[0];
      if (existing?.id) return { ok: true, organizationId: existing.id };
    }
    const slug = `personal-${crypto.randomUUID().slice(0, 12)}`;
    const created = await authClient.organization.create({ name: displayName, slug });
    if (created.error || !created.data?.id) {
      return { ok: false, code: codeOf(created.error) };
    }
    return { ok: true, organizationId: created.data.id };
  } catch {
    return { ok: false, code: "unreachable" };
  }
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    const status = (error as { status?: unknown }).status;
    if (status === 401) return "unauthorized";
    if (status === 403) return "forbidden";
    if (status === 503) return "auth-not-configured";
  }
  return "unreachable";
}

/** `POST /api/workspaces/claim`: the one write that gives an anonymous workspace an owner. */
export async function claimWorkspace(input: {
  workspaceId: string;
  organizationId: string;
}): Promise<{ ok: true; status: "claimed" | "unchanged" } | { ok: false; code: string }> {
  try {
    const response = await fetch(claimWorkspaceUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
      return { ok: false, code: typeof code === "string" ? code : `http-${response.status}` };
    }
    const status = body && typeof body === "object" ? (body as { status?: unknown }).status : null;
    return { ok: true, status: status === "claimed" ? "claimed" : "unchanged" };
  } catch {
    return { ok: false, code: "unreachable" };
  }
}

/** The session as the server states it, or `null` when there is none. Never throws. */
export async function readSessionUser(): Promise<unknown> {
  try {
    const { data } = await authClient.getSession();
    if (data === null) return null;
    return (data as { user?: unknown } | undefined)?.user ?? null;
  } catch {
    return null;
  }
}
