/**
 * Build-time deployment profile.
 *
 * One codebase ships three profiles. A hosted free build is static assets only
 * (`standalone`): no relay, no sharing, everything it makes lives in this
 * browser. Self-hosted and hosted paid builds (`relay`) keep full parity, and
 * the licence gates the relay rather than a feature.
 *
 * `VITE_SUITE_MODE` is inlined by Vite at build time, so a standalone bundle
 * carries no relay URL and cannot render a control that needs one. The default
 * is `relay`: an un-configured build keeps the full product.
 */
export type SuiteMode = "standalone" | "relay";

/** No `VITE_SUITE_MODE` means the full product; a bare checkout keeps working. */
export const DEFAULT_SUITE_MODE: SuiteMode = "relay";

/**
 * Fragment marker left behind once a share token has been exchanged for the
 * session cookie. Mirrors `SHARE_SESSION_FRAGMENT` in `shares.ts`; it is copied
 * rather than imported so this module never pulls in the share client.
 */
const SHARE_SESSION_MARKER = "#share-session";

/** The profile this build was compiled for. */
export function suiteMode(): SuiteMode {
  return import.meta.env.VITE_SUITE_MODE === "standalone" ? "standalone" : DEFAULT_SUITE_MODE;
}

/** True in the hosted free profile: IndexedDB only, no relay, no sharing. */
export function isStandalone(): boolean {
  return suiteMode() === "standalone";
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

/** A standalone build has none of the relay machinery. */
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

export function bootPlan(mode: SuiteMode, url: string): BootPlan {
  // In a standalone build a share link is just a page URL: there is no relay to
  // resolve or claim against, so nothing runs and `main.tsx` says the build is
  // local-only instead of turning a capability link into a network error.
  if (mode === "standalone") return LOCAL_ONLY_PLAN;
  // There is no claim step left at boot: an account session is minted from the
  // cookie on the first room join, and an anonymous workspace is linked to an
  // account by `onLinkAccount` at sign-up (ADR-0076).
  return {
    resolveShare: hasShareLink(url),
    connectProvider: true,
    showSharing: true,
  };
}
