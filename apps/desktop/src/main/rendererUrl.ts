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
