import type { PasskeyResult } from "./passkey";

/**
 * The three ways in, and the one thing the screen remembers about them
 * (ADR-0067 §11).
 *
 * There are no passwords: a password is a secret people reuse, and this product
 * already has one thing people lose. Better Auth's `lastLoginMethod` plugin
 * records the method that worked last in a **non-httpOnly cookie** — it is a
 * convenience, not a credential — so the screen can offer *"continue with your
 * passkey"* instead of four equal buttons.
 */
export type SignInMethod = "passkey" | "magic-link" | "google";

/** Must match the server plugin's `cookieName` (Better Auth's default). */
export const LAST_LOGIN_METHOD_COOKIE = "better-auth.last_used_login_method";

const KNOWN: readonly SignInMethod[] = ["passkey", "magic-link", "google"];

function asMethod(value: string | null | undefined): SignInMethod | null {
  return KNOWN.find((method) => method === value) ?? null;
}

/** The last method that worked, or `null` on a first visit or a cookie-less browser. */
export function readLastLoginMethod(cookie: string | null): SignInMethod | null {
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LAST_LOGIN_METHOD_COOKIE) continue;
    return asMethod(decodeURIComponent(rest.join("=")));
  }
  return null;
}

export interface MethodOffer {
  method: SignInMethod;
  /** Whether this is the method that worked last, so it can lead the list. */
  recent: boolean;
  /** The button's words: an offer to repeat, or a plain way in. */
  label: string;
}

const LABELS: Record<SignInMethod, { recent: string; plain: string }> = {
  passkey: { recent: "Continue with your passkey", plain: "Use a passkey" },
  "magic-link": { recent: "Continue with a magic link", plain: "Email me a sign-in link" },
  google: { recent: "Continue with Google", plain: "Continue with Google" },
};

/**
 * The three methods in the order a person should read them: the one that worked
 * last first, the rest in a fixed order so the screen does not shuffle.
 */
export function signInOffers(last: SignInMethod | null): MethodOffer[] {
  return KNOWN.map((method) => ({
    method,
    recent: method === last,
    label: method === last ? LABELS[method].recent : LABELS[method].plain,
  })).sort((left, right) => Number(right.recent) - Number(left.recent));
}

export type SignInResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * A deliberately loose check: the address is validated by the server, and a
 * client-side regex that rejects a legal address is worse than one that lets the
 * server say no.
 */
export function emailProblem(email: string): string | null {
  const value = email.trim();
  if (value.length === 0) return "Enter the address to send the link to.";
  if (!value.includes("@") || value.startsWith("@") || value.endsWith("@")) {
    return "That does not look like an email address.";
  }
  return null;
}

/** The three actions the dialog calls. Injected, so the dialog needs no network. */
export interface SignInActions {
  passkey: () => Promise<PasskeyResult>;
  magicLink: (email: string) => Promise<SignInResult>;
  google: () => Promise<SignInResult>;
}
