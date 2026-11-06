/**
 * The build is local. There is one profile.
 *
 * The canvas used to ship three: a static standalone build, a self-hosted relay
 * and a hosted paid build. The relay and the hosted tier are gone, so what
 * remains is the one that always worked without a server — a document in this
 * app, on this machine, with the file as the only copy that matters.
 *
 * `VITE_SUITE_MODE` is kept as the name of the compile-time switch because a
 * bundle still inlines it; a value other than the default is refused rather than
 * silently half-honoured.
 */
export type SuiteMode = "local";

/** The only profile there is. */
export const DEFAULT_SUITE_MODE: SuiteMode = "local";

/**
 * Fragment marker left behind once a share token has been exchanged for the
 * session cookie. Mirrors `SHARE_SESSION_FRAGMENT` in `shares.ts`; it is copied
 * rather than imported so this module never pulls in the share client.
 */
const SHARE_SESSION_MARKER = "#share-session";

/**
 * The profile this build was compiled for.
 *
 * A build that asked for `relay` asks for something this repository no longer
 * contains, so it gets the local profile and says so once at boot rather than
 * rendering controls whose backing service is missing.
 */
export function suiteMode(): SuiteMode {
  if (import.meta.env.VITE_SUITE_MODE === "relay") {
    console.warn("Suite Canvas: VITE_SUITE_MODE=relay is retired; this build is local.");
  }
  return DEFAULT_SUITE_MODE;
}

/**
 * True, always: the app is local.
 *
 * Every call site asks "may this reach the relay?" — attachments, sketch files,
 * video, templates, the share session. The answer is now the same everywhere, and
 * the branches behind it are unreachable. They are kept until each is deleted
 * with its feature, because removing the gate before the code behind it is how
 * an app starts offering a button whose service is gone.
 */
export function isStandalone(): boolean {
  return true;
}

/**
 * What boot does for a profile and a page URL. A pure function of both, so the
 * behaviour of a `?share=` link in a standalone build is a test rather than a
 * runtime accident.
 */
export interface BootPlan {
  /** Trade `?share=` (or the resume marker) for a share session. */
  resolveShare: boolean;
  /** Open the sync provider's socket. */
  connectProvider: boolean;
  /** Render sharing controls: the Share menu, the publish button. */
  showSharing: boolean;
}

/** There is no relay machinery to plan for. */
const LOCAL_ONLY_PLAN: BootPlan = {
  resolveShare: false,
  connectProvider: false,
  showSharing: false,
};

/** Query and fragment of a page URL; relative URLs resolve against a placeholder. */
function parsePageUrl(url: string): URL | null {
  try {
    return new URL(url, "http://suite.invalid");
  } catch {
    return null;
  }
}

/** True when `url` carries a share link, or the marker a resolved link leaves behind. */
export function hasShareLink(url: string): boolean {
  const parsed = parsePageUrl(url);
  if (!parsed) return false;
  return parsed.searchParams.has("share") || parsed.hash === SHARE_SESSION_MARKER;
}

/** Workspace named by `?workspace=` (or the legacy `?doc=`), if any. */
export function workspaceIdFromUrl(url: string): string | null {
  const parsed = parsePageUrl(url);
  if (!parsed) return null;
  const id = parsed.searchParams.get("workspace") ?? parsed.searchParams.get("doc");
  return id !== null && id.length > 0 ? id : null;
}

/**
 * What boot does: nothing that needs a server.
 *
 * A `?share=` link is just a page URL now — there is no relay to resolve a token
 * against, so a stale link opens the launcher instead of failing as a network
 * error.
 */
export function bootPlan(_mode: SuiteMode, _url: string): BootPlan {
  return LOCAL_ONLY_PLAN;
}
