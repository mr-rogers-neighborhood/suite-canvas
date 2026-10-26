/**
 * An authenticated workspace, without a browser form.
 *
 * ## What replaced the owner key
 *
 * A workspace used to be opened as `/?workspace=<id>#owner=<uuid>`: the fragment
 * was a bearer capability the relay hashed and remembered, and every spec minted
 * its own so two browsers could share one document. Both ends of that are gone
 * (ADR-0076). The relay now accepts exactly one credential — a Better Auth session
 * JWT whose `org` claim matches the organization recorded for the workspace
 * (ADR-0074) — and the client gets that JWT by trading its httpOnly session cookie
 * at `GET /api/auth/token` (`apps/canvas/src/auth/credential.ts`).
 *
 * A cookie the page cannot read is the whole reason this file is a setup rather
 * than a helper the test could call after `goto`: the only way to hold that cookie
 * is to let a browser have it. So the run signs in once, in
 * `scripts/global-setup.mjs`, and every spec that needs an account declares
 * `test.use({ storageState: ACCOUNT_STATE })`. Playwright merges those options into
 * *every* context it creates — including `browser.newContext()` calls a test makes
 * by hand — so a two-browser spec gets two browsers that are the same account, and
 * neither of them fills in a form.
 *
 * ## Where the pages live
 *
 * Accounts need the control plane, and the control plane is a second origin
 * (`:1236`) that answers no CORS preflight. A production install hides that behind
 * the reverse proxy in `compose.yaml`, so this suite runs the same shape:
 * `ACCOUNT_ORIGIN` is the hosted origin in `scripts/hosted-origin.mjs`, which
 * serves the canvas and forwards `/api/auth/*` to the control plane. `hostedUrl`
 * moves a workspace path onto that origin.
 *
 * A page that only opens a workspace and edits keeps the plain `baseURL`
 * (`:5173`, the bare Vite dev server): anonymous local use is still a supported
 * deployment, and those specs must keep proving it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The session the setup wrote. Kept in step with `ACCOUNT_STATE_PATH` in
 * `scripts/global-setup.mjs`; both resolve to `e2e/.data/account.json`.
 */
export const ACCOUNT_STATE = path.join(E2E_DIR, ".data", "account.json");

/** The origin a page shares with the account API: canvas plus `/api/auth`. */
export const ACCOUNT_ORIGIN = "http://localhost:5180";

/** A workspace path, moved onto the hosted origin. */
export function hostedUrl(target: string): string {
  return `${ACCOUNT_ORIGIN}${target}`;
}

let sequence = 0;

/** A workspace id nothing else in the run will use. */
export function accountWorkspaceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${++sequence}`;
}

/** A hosted workspace URL, unclaimed. Enough for the relay, which records the org on first open. */
export function accountUrl(prefix: string): string {
  return hostedUrl(`/?workspace=${accountWorkspaceId(prefix)}`);
}

export interface AccountWorkspace {
  id: string;
  url: string;
}

/**
 * A hosted workspace URL *and* the control plane's row for it.
 *
 * The relay records which organization owns a workspace the first time a verified
 * session opens it, so a claim is not needed to sync. It is needed for the
 * account-side routes that read that row (`GET /api/workspaces/:id/members`) and
 * for a quota to be counted at all, so a spec that means "this workspace belongs
 * to the account" says so here once instead of assuming the relay's copy is the
 * only one.
 */
export async function accountWorkspace(
  request: APIRequestContext,
  prefix: string,
): Promise<AccountWorkspace> {
  const id = accountWorkspaceId(prefix);
  const claimed = await request.post(hostedUrl("/api/workspaces/claim"), {
    data: { workspaceId: id },
  });
  if (!claimed.ok()) {
    throw new Error(
      `claiming ${id} failed: ${claimed.status()} ${(await claimed.text()).slice(0, 400)}`,
    );
  }
  return { id, url: hostedUrl(`/?workspace=${id}`) };
}
