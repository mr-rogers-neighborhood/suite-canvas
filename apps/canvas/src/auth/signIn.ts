import type { PasskeyResult } from "./passkey";

/**
 * The ways in, and the one thing the screen remembers about them.
 *
 * Four methods, because a deployment can offer all four (ADR-0077 opens sign-up
 * and keeps the email path): a passkey, a password, a magic link, and Google. The
 * password is here for the same reason sign-up is — a stranger with no passkey and
 * no Google account has to be able to pay for a subscription — and the copy never
 * pretends one door is safer than another.
 *
 * Better Auth's `lastLoginMethod` plugin records the method that worked last in a
 * **non-httpOnly cookie** — a convenience, not a credential — so the screen can
 * offer *"continue with your passkey"* instead of four equal buttons.
 */
export type SignInMethod = "passkey" | "password" | "magic-link" | "google";

/** Must match the server plugin's `cookieName` (Better Auth's default). */
export const LAST_LOGIN_METHOD_COOKIE = "better-auth.last_used_login_method";

const KNOWN: readonly SignInMethod[] = ["passkey", "password", "magic-link", "google"];

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
  password: { recent: "Sign in with your password", plain: "Use a password" },
  "magic-link": { recent: "Continue with a magic link", plain: "Email me a sign-in link" },
  google: { recent: "Continue with Google", plain: "Continue with Google" },
};

/**
 * The four methods in the order a person should read them: the one that worked
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

/** What the client requires of a password before it is sent anywhere. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * The password rule, stated the way the server will apply it: length is the only
 * thing worth enforcing client-side, because composition rules push people toward
 * `Password1!` and the server's own policy is the authority.
 */
export function passwordProblem(password: string): string | null {
  if (password.length === 0) return "Enter your password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase is easier than a short scramble.`;
  }
  return null;
}

/** What a new account needs before it is created. */
export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  /** The challenge answer, when the deployment turned Turnstile on. */
  captchaToken?: string | null;
}

/** The actions the dialog calls. Injected, so the dialog needs no network. */
export interface SignInActions {
  passkey: () => Promise<PasskeyResult>;
  password: (input: { email: string; password: string }) => Promise<SignInResult>;
  magicLink: (email: string) => Promise<SignInResult>;
  google: () => Promise<SignInResult>;
  signUp: (input: SignUpInput) => Promise<SignInResult>;
}
