/**
 * The Turnstile site key, when the deployment turned the challenge on (ADR-0077).
 *
 * Public by design: Cloudflare's widget needs it in the page, and it is inlined at
 * build time by Vite. Two surfaces ask a visitor to prove they are a person — sign-up
 * and the feedback bubble — so the reader lives here rather than in whichever of them
 * was written first.
 */
export function captchaSiteKey(): string | null {
  const key = import.meta.env.VITE_SUITE_TURNSTILE_SITE_KEY;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}
