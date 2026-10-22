/**
 * The workspace owner key is a bearer capability kept by the browser, not by the
 * server: the relay stores only its SHA-256 hash. It travels in the editor URL
 * fragment so it is never sent in a request or a referrer.
 */

import { collabHttpBase } from "./endpoints";

export const OWNER_KEY_PREFIX = "suite.owner.";
export const WORKSPACE_API_PATH = "/api/workspaces";
/** The claim call must never delay a local-first boot for long. */
export const CLAIM_TIMEOUT_MS = 2500;

const OWNER_KEY_BYTES = 32;

export type ClaimStatus = "claimed" | "conflict" | "offline";

export interface OwnerSession {
  ownerKey: string;
  claim: ClaimStatus;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/** 32 random bytes as base64url; the server only ever sees the hash. */
export function generateOwnerKey(): string {
  const bytes = new Uint8Array(OWNER_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function readOwnerKey(workspaceId: string): string | null {
  if (!hasStorage() || workspaceId.trim().length === 0) return null;
  try {
    const stored = window.localStorage.getItem(`${OWNER_KEY_PREFIX}${workspaceId}`);
    return stored !== null && stored.trim().length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function writeOwnerKey(workspaceId: string, ownerKey: string): void {
  if (!hasStorage() || workspaceId.trim().length === 0 || ownerKey.trim().length === 0) return;
  try {
    window.localStorage.setItem(`${OWNER_KEY_PREFIX}${workspaceId}`, ownerKey);
  } catch {
    // A full or disabled localStorage must not block opening a workspace.
  }
}

/**
 * Drops the key this browser holds. The relay still has the workspace and its
 * hashed key, so a recovery file or owner link can reclaim access later.
 */
export function forgetOwnerKey(workspaceId: string): void {
  if (!hasStorage() || workspaceId.trim().length === 0) return;
  try {
    window.localStorage.removeItem(`${OWNER_KEY_PREFIX}${workspaceId}`);
  } catch {
    // Ignore: a browser that cannot write cannot hold a key either.
  }
}

/** The owner key in a `#owner=<key>` fragment, if the page has one. */
export function ownerKeyFromFragment(hash?: string): string | null {
  const source = hash ?? (typeof window === "undefined" ? "" : window.location.hash);
  const fragment = source.startsWith("#") ? source.slice(1) : source;
  if (fragment.length === 0) return null;
  const key = new URLSearchParams(fragment).get("owner");
  return key !== null && key.trim().length > 0 ? key : null;
}

/** Replaces the hash with the owner fragment, keeping the query intact. */
export function withOwnerFragment(url: string, ownerKey: string): string {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const next = new URL(url, base);
  next.hash = `owner=${encodeURIComponent(ownerKey)}`;
  return next.toString();
}

/**
 * Rewrites the fragment and boots the app again. A fragment-only `assign` would
 * not reload, so the in-memory session would keep the old key; the reload is
 * what makes a freshly imported or rotated key the one the app uses.
 */
export function reloadWithOwnerKey(ownerKey: string): void {
  window.history.replaceState(null, "", withOwnerFragment(window.location.href, ownerKey));
  window.location.reload();
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(CLAIM_TIMEOUT_MS)
    : undefined;
}

/**
 * Registers this key with the relay. A network failure is not a conflict: the
 * workspace keeps working locally and the claim is retried on a later open.
 */
export async function claimWorkspace(workspaceId: string, ownerKey: string): Promise<ClaimStatus> {
  const url = `${collabHttpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(workspaceId)}/claim`;
  let response: Response;
  try {
    const signal = timeoutSignal();
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerKey }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return "offline";
  }

  if (response.status === 409) return "conflict";
  return response.ok ? "claimed" : "offline";
}

/**
 * Picks the key this tab should use: an explicit fragment key wins over a stored
 * one, and neither existing key is discarded when the claim conflicts.
 */
export async function prepareOwnerSession(workspaceId: string): Promise<OwnerSession> {
  const fromFragment = ownerKeyFromFragment();
  let ownerKey = fromFragment ?? readOwnerKey(workspaceId);
  if (!ownerKey) {
    ownerKey = generateOwnerKey();
    writeOwnerKey(workspaceId, ownerKey);
  }
  const claim = await claimWorkspace(workspaceId, ownerKey);
  // An editor link opened on a fresh browser should keep working without the
  // fragment next time, but a conflicting key must not replace a stored one.
  if (fromFragment && claim !== "conflict") writeOwnerKey(workspaceId, ownerKey);
  return { ownerKey, claim };
}

function serverMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>).error;
  return typeof value === "string" ? value.trim() : "";
}

function rotateError(status: number, body: unknown): string {
  const message = serverMessage(body);
  if (message.length > 0) return message;
  if (status === 401) return "The server did not receive the current owner key.";
  if (status === 403) return "This browser no longer holds the current owner key.";
  if (status === 400) return "The new owner key was refused.";
  return `The owner key could not be replaced (${status}).`;
}

/**
 * Replaces the owner key on the relay. The current key travels in the
 * Authorization header, so it never appears in the URL or the request body.
 * Resolves only when the server accepted the new key.
 */
export async function rotateOwnerKey(
  workspaceId: string,
  currentOwnerKey: string,
  newOwnerKey: string,
): Promise<void> {
  const url = `${collabHttpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(workspaceId)}/rotate`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${currentOwnerKey}`,
      },
      body: JSON.stringify({ newOwnerKey }),
    });
  } catch {
    throw new Error("Could not reach the workspace server. The owner key was not changed.");
  }
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  throw new Error(rotateError(response.status, body));
}
