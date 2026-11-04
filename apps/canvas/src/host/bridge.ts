/**
 * Which process is hosting this renderer.
 *
 * The renderer is one bundle on the web and on the desktop. What differs is what
 * it can reach: a browser has IndexedDB and `fetch`, a desktop build has a main
 * process with the file, the menu and the operating system. The host signal is
 * the bridge the preload injects, not a build flag — a flag would say what was
 * compiled, while the renderer needs to know what actually loaded beside it.
 *
 * The bridge is deliberately tiny. Every method added here is a new thing the
 * renderer may ask the main process to do, so each one is added in the increment
 * that needs it and allowlisted in the preload.
 */

/** Global the preload sets. One name, so there is one thing to look for. */
export const DESKTOP_BRIDGE_KEY = "suiteDesktop";

/** What a desktop build's preload exposes. A present bridge *is* the desktop. */
export interface DesktopBridge {
  readonly host: "desktop";
  /** The shell's own version, for diagnostics and for a minimum-shell check. */
  readonly version: string;
}

export type HostKind = "web" | "desktop";

interface BridgeScope {
  readonly suiteDesktop?: unknown;
}

function isDesktopBridge(value: unknown): value is DesktopBridge {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { host?: unknown; version?: unknown };
  return candidate.host === "desktop" && typeof candidate.version === "string";
}

/**
 * The bridge, when a desktop shell is hosting this renderer.
 *
 * The scope is a parameter so the answer is a test rather than something that
 * depends on how the test runner was started.
 */
export function desktopBridge(
  scope: BridgeScope = globalThis as unknown as BridgeScope,
): DesktopBridge | null {
  return isDesktopBridge(scope.suiteDesktop) ? scope.suiteDesktop : null;
}

/** `"desktop"` when a bridge is present, otherwise `"web"`. */
export function hostKind(scope?: BridgeScope): HostKind {
  return desktopBridge(scope) === null ? "web" : "desktop";
}
