import { anonymousClient, magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { forgetCredential } from "./credential";
import { authClientBase } from "./endpoints";
import { codeOf } from "./organization";
import { type PasskeyRequestOptions, signInWithPasskey } from "./passkey";
import {
  readLastLoginMethod,
  type SignInActions,
  type SignInMethod,
  type SignInResult,
  type SignUpInput,
} from "./signIn";

/**
 * The Better Auth client, and the only module that talks to it over its own API.
 *
 * Everything that renders takes actions as props, so a component test needs no
 * network and no server: this file is where the real transport lives, and it is
 * deliberately small.
 *
 * The plugins are the ones this surface uses: `magicLinkClient` for
 * `signIn.magicLink`, `organizationClient` for members and invitations, and
 * `anonymousClient` because an account-less device now gets a real (anonymous)
 * session — the server's `onLinkAccount` is what later hands its workspaces to the
 * account somebody signs up for (ADR-0076). `lastLoginMethod` needs no client
 * plugin: the server records the method in a readable cookie, and
 * `readLastLoginMethod` parses that cookie directly.
 *
 * Billing is *not* a plugin here: `@better-auth/stripe`'s client half would be a
 * second dependency for three `fetch` calls, and `billing.ts` already owns them.
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
  plugins: [magicLinkClient(), organizationClient(), anonymousClient()],
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
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
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

/** Password, magic link, Google and the passkey ceremony — the four ways in. */
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

  password: async ({ email, password }): Promise<SignInResult> => {
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) {
        // An unverified address is a state, not a failure: say what to do next.
        if (codeOf(error) === "EMAIL_NOT_VERIFIED") {
          return {
            ok: false,
            message: `Check ${email.trim()} for the verification link, then sign in again.`,
          };
        }
        return {
          ok: false,
          message: messageOf(error, "That email and password were not accepted."),
        };
      }
      return { ok: true, message: "Signed in." };
    } catch {
      return { ok: false, message: "The account service did not answer." };
    }
  },

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

  signUp: async (input: SignUpInput): Promise<SignInResult> => {
    try {
      const { error } = await authClient.signUp.email({
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
        callbackURL: returnUrl(),
        ...(input.captchaToken
          ? { fetchOptions: { headers: { "x-captcha-response": input.captchaToken } } }
          : {}),
      });
      if (error) {
        return { ok: false, message: messageOf(error, "That account could not be created.") };
      }
      return {
        ok: true,
        message: `Check ${input.email.trim()} to verify the address. Your workspaces come with you once you do.`,
      };
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
  } finally {
    // The minted JWT is dead the moment the cookie is: drop it either way.
    forgetCredential();
  }
}

export type AnonymousSignIn = { ok: true } | { ok: false; code: string };

/**
 * Gives this browser an anonymous session, which is what lets a workspace made
 * without an account be linked to one later (ADR-0076).
 *
 * It is not a sign-in the reader sees: no email, no name, no prompt. A deployment
 * that has the plugin off answers `ANONYMOUS_USERS_NOT_FOUND` or a 404, and that
 * is "unavailable" rather than an error — local use never depends on it.
 */
export async function signInAnonymously(): Promise<AnonymousSignIn> {
  try {
    const { error } = await authClient.signIn.anonymous();
    if (error) return { ok: false, code: codeOf(error) };
    return { ok: true };
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
