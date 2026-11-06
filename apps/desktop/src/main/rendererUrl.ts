/**
 * Which page the window loads.
 *
 * Two sources, and the difference matters:
 *
 * - **the dev server** (`SUITE_DESKTOP_DEV_URL`) when one is running, so a
 *   component edit appears in the window. This is the development loop.
 * - **the bundled entry point** (`app://canvas/index.html`) otherwise, which is
 *   what the packaged app ships and what the e2e tier exercises.
 *
 * It lives apart from `index.ts` so the rule is a test rather than something only
 * a running window can discover, and because `index.ts` imports Electron.
 */

/** The packaged scheme. `app://` is a real, secure origin, so routes keep working. */
export const BUNDLED_ENTRY = "app://canvas/index.html";

/** The dev server, when one was configured. */
export function devServerUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.SUITE_DESKTOP_DEV_URL?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * The page to load.
 *
 * Every navigation goes through here — the launcher, an opened document and the
 * `will-navigate` guard — because a window that half-follows the seam bounces
 * between two origins on the first open.
 */
export function rendererUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const dev = devServerUrl(env);
  const url = dev !== null ? new URL("/index.html", dev) : new URL(BUNDLED_ENTRY);
  return withSyncParams(url, env);
}

/**
 * The dev sync transport, handed to the renderer as query parameters.
 *
 * A real shell would pass this through the bridge; the query is the smallest
 * seam that lets two copies of the app join one `suite-sync` server. The
 * renderer caches it in sessionStorage because it rewrites its URL to the board.
 */
function withSyncParams(url: URL, env: NodeJS.ProcessEnv): URL {
  const syncUrl = env.SUITE_SYNC_URL?.trim();
  const member = env.SUITE_SYNC_MEMBER?.trim();
  if (syncUrl === undefined || syncUrl.length === 0) return url;
  if (member === undefined || member.length === 0) return url;

  url.searchParams.set("syncUrl", syncUrl);
  url.searchParams.set("member", member);
  url.searchParams.set("epoch", env.SUITE_SYNC_EPOCH?.trim() || "1");

  const workspace = env.SUITE_SYNC_WORKSPACE?.trim();
  if (workspace !== undefined && workspace.length > 0) {
    url.searchParams.set("syncWorkspace", workspace);
  }

  const device = env.SUITE_SYNC_DEVICE?.trim();
  if (device !== undefined && device.length > 0) {
    url.searchParams.set("device", device);
  }

  return url;
}

/** Whether a navigation target belongs to the renderer this build is using. */
export function isRendererOrigin(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dev = devServerUrl(env);
  if (dev === null) return url.startsWith("app://canvas/");
  try {
    return new URL(url).origin === new URL(dev).origin;
  } catch {
    return false;
  }
}
