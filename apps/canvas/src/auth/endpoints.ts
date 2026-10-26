/**
 * Where the account service lives.
 *
 * A hosted deployment serves Better Auth — and every route this client uses,
 * including billing and the relay's token mint — at `/api/auth` on the page's
 * own origin, so a build with nothing configured is same-origin and CORS never
 * enters the picture. `VITE_SUITE_AUTH_URL` names a separate auth host (a
 * self-hosted control plane); when it is set, every route hangs off it instead.
 *
 * There is no invented default host. A build with no auth server and no
 * configuration resolves to the page origin, which answers `unavailable` in
 * `availability.ts` rather than pretending an account exists.
 */

type PageLocation = Pick<Location, "origin">;

function envValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pageLocation(): PageLocation | null {
  return typeof window === "undefined" ? null : window.location;
}

/** The service base without a trailing slash: the configured host, else the page origin. */
export function authServiceBase(location: PageLocation | null = pageLocation()): string {
  const configured = envValue(import.meta.env.VITE_SUITE_AUTH_URL);
  if (configured !== null) return configured.replace(/\/+$/u, "");
  return location?.origin ?? "";
}

/** Better Auth's own mount: sign-in, sign-up, passkeys, magic link, Google, sessions, billing. */
export function authClientBase(location: PageLocation | null = pageLocation()): string {
  return `${authServiceBase(location)}/api/auth`;
}
