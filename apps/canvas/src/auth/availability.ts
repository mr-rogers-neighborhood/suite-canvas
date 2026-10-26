import { authClientBase } from "./endpoints";

/**
 * Whether this deployment has accounts at all
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §8).
 *
 * A local-only install has no server, so it has no session and no sign-in
 * surface worth showing. The distinction that matters to a person is *"you are
 * not signed in"* versus *"accounts do not exist here"*, and the only honest way
 * to tell them apart is to ask the deployment once.
 *
 * `Better Auth` answers `GET /api/auth/ok` with `{ ok: true }`. Anything else —
 * a 404 from a static host, a 503 `auth-not-configured` from the control plane,
 * an HTML page from a dev server's SPA fallback, a network failure, a timeout —
 * is "unavailable". The JSON check is not pedantry: a Vite dev server answers
 * unknown paths with `index.html`, and a surface that only looked at the status
 * code would offer a magic-link form that can never send anything.
 */
export type AuthAvailability = "unknown" | "available" | "unavailable";

const PROBE_TIMEOUT_MS = 2500;

export interface ProbeInput {
  /** Better Auth's mount, normally from {@link authClientBase}. */
  base?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Asks the deployment whether accounts exist. Never throws. */
export async function probeAuth(input: ProbeInput = {}): Promise<AuthAvailability> {
  const base = input.base ?? authClientBase();
  const send = input.fetch ?? globalThis.fetch;
  if (typeof send !== "function") return "unavailable";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    const response = await send(`${base}/ok`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") return "unavailable";
    return (body as { ok?: unknown }).ok === true ? "available" : "unavailable";
  } catch {
    // No server, no CORS, no DNS, no time: all the same answer to a reader.
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
