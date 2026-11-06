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
 * The desktop policy.
 *
 * There is no dev exception. A page that could open a socket would be a page whose
 * `connect-src 'self'` promise was conditional, and the sync transport that needed one
 * now lives in the main process, where a policy does not apply.
 */
export function desktopCsp(): string {
  return DESKTOP_CSP;
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
