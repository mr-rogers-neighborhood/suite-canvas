import {
  desktopCsp as baseCsp,
  resolveProtocolAsset,
  scriptSrcDirective as sharedScriptSrcDirective,
} from "@suite/desktop";

/**
 * The page policy for the Canvas renderer.
 *
 * The policy itself is shared with the other Suite apps; this module only adds
 * the two things that are Canvas's business: the `app://canvas` host, and the
 * dev sync server's origin when one is configured.
 */
export const DESKTOP_CSP = baseCsp();

/**
 * The desktop policy with an optional dev sync origin.
 *
 * The shipped profile is local-only. The dev `suite-sync` transport is the one
 * exception, and only when `SUITE_SYNC_URL` names a WebSocket origin. A policy
 * that cannot open the socket would make the demo look like a sync bug.
 */
export function desktopCsp(env: NodeJS.ProcessEnv = process.env): string {
  const origin = syncOrigin(env.SUITE_SYNC_URL);
  return origin === null ? DESKTOP_CSP : baseCsp({ connectSrc: [origin] });
}

function syncOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The `script-src` directive on its own, for a caller that checks the policy. */
export function scriptSrcDirective(policy: string = DESKTOP_CSP): string {
  return sharedScriptSrcDirective(policy);
}

/**
 * Resolve a request to a file inside the renderer bundle, or refuse it.
 *
 * `app://canvas/...` is a real origin, so a document keeps the query-parameter
 * routes it already has and relative asset paths still resolve. The climb and
 * host rules live in `@suite/desktop`, shared with the other apps.
 */
export function resolveAppAsset(
  requestUrl: string,
  root: string,
): { readonly ok: true; readonly file: string } | { readonly ok: false } {
  return resolveProtocolAsset(requestUrl, root, { scheme: "app", hosts: ["canvas"] });
}
