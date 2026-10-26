/**
 * Adds an owner-key fragment to a workspace URL.
 *
 * Workspace writes and share management require the owner key, and the first
 * key to claim a workspace wins. Two browser contexts in one test are two
 * browsers, so they must present the same key or the second one is refused as
 * a different owner. Tests that open one context are unaffected.
 */
export function withOwnerKey(url: string): string {
  return `${url}#owner=${crypto.randomUUID()}`;
}
