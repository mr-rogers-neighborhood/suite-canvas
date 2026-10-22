/**
 * Collab endpoints. A hosted build serves `/api` and `/ws` from the page's own
 * origin, so a production build without `VITE_COLLAB_*` is still usable and
 * can never mix an `https` page with a `ws://` socket.
 */

/** Matches the collab server's default ports in development. */
const DEV_HTTP_URL = "http://localhost:1235";
const DEV_WS_URL = "ws://localhost:1234";

type PageLocation = Pick<Location, "origin" | "protocol" | "host">;

function envValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pageLocation(): PageLocation | null {
  return typeof window === "undefined" ? null : window.location;
}

/**
 * Base URL for `/api` requests. The production fallback is the page origin, so
 * requests stay same-origin and CORS is not involved at all.
 */
export function collabHttpBase(location: PageLocation | null = pageLocation()): string {
  const configured = envValue(import.meta.env.VITE_COLLAB_HTTP_URL);
  if (configured !== null) return configured.replace(/\/+$/u, "");
  if (import.meta.env.DEV) return DEV_HTTP_URL;
  return location?.origin ?? "";
}

/**
 * WebSocket URL for the Loro sync server. In production the reverse proxy
 * terminates TLS and routes `/ws` to the sync port on the same origin.
 */
export function collabWsUrl(location: PageLocation | null = pageLocation()): string {
  const configured = envValue(import.meta.env.VITE_COLLAB_URL);
  if (configured !== null) return configured;
  if (import.meta.env.DEV || location === null) return DEV_WS_URL;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}
