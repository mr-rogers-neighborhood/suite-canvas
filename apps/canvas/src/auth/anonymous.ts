/**
 * The anonymous rung (ADR-0076, ADR-0077).
 *
 * A workspace works with no account, and that never needed a key: the browser
 * keeps the document in IndexedDB, and this module gives it a Better Auth
 * *anonymous* session so the server can later attach that work to a real account.
 * The hand-over is `onLinkAccount` in the server's `anonymous` plugin, which runs
 * once, while a real sign-in happens — so there is no claim route, no retry loop
 * and no second credential on this side.
 *
 * What this module owns is only the local memory that makes the one prompt
 * honest: that this device *did* work anonymously, and how much it holds.
 */

import { getSession } from "../session/session";
import { readRecentWorkspaces } from "../session/workspaceTransfer";

/** Remembers that this browser was given an anonymous session. Never a credential. */
export const ANONYMOUS_FLAG = "suite.anonymous-session.v1";

export type AnonymousAnswer = "signed-in" | "anonymous" | "unavailable";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Records that the server issued this browser an anonymous session. */
export function rememberAnonymousSession(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(ANONYMOUS_FLAG, "1");
  } catch {
    // Nothing depends on the flag: the account still links, only the prompt is lost.
  }
}

/** Whether this device worked without an account before it signed in. */
export function hadAnonymousSession(): boolean {
  if (!hasStorage()) return false;
  try {
    return window.localStorage.getItem(ANONYMOUS_FLAG) === "1";
  } catch {
    return false;
  }
}

/** Clears the flag once the one prompt has been shown. */
export function forgetAnonymousSession(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(ANONYMOUS_FLAG);
  } catch {
    // Idempotent by nature: a browser that cannot write has nothing to clear.
  }
}

/**
 * The workspace ids this device already holds: the launcher's recents list plus
 * the workspace in the URL. Nothing new is persisted to make the hand-over
 * possible — the list is where the app records local workspaces anyway.
 */
export function localWorkspaceIds(): string[] {
  const ids = readRecentWorkspaces().map((entry) => entry.id);
  const open = getSession().workspaceId;
  if (open) ids.unshift(open);
  return [...new Set(ids)];
}

export interface LinkPrompt {
  /** How many workspaces moved, for the sentence. */
  count: number;
  /** One sentence, in the reader's terms: which work, and where it went. */
  message: string;
}

/**
 * The one prompt: a device that worked anonymously signed in, so say that its
 * workspaces are now the account's. `null` when there is nothing to say — a
 * device that never worked anonymously, or one that held no workspaces.
 */
export function linkPrompt(input: {
  email: string | null;
  workspaceIds: readonly string[];
  wasAnonymous: boolean;
}): LinkPrompt | null {
  const ids = [...new Set(input.workspaceIds.map((id) => id.trim()))].filter((id) => id.length > 0);
  if (!input.wasAnonymous || ids.length === 0) return null;
  const noun = ids.length === 1 ? "workspace" : "workspaces";
  const them = ids.length === 1 ? "it" : "them";
  const where = input.email === null ? "your account" : input.email;
  return {
    count: ids.length,
    message: `${ids.length} local ${noun} now ${ids.length === 1 ? "belongs" : "belong"} to ${where}. The links did not change, and ${them} ${ids.length === 1 ? "opens" : "open"} exactly as before.`,
  };
}
