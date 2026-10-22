/**
 * The workspace owner key is a bearer capability kept by the browser, not by the
 * server: the relay stores only its SHA-256 hash. It travels in the editor URL
 * fragment so it is never sent in a request or a referrer.
 */

export const OWNER_KEY_PREFIX = "suite.owner.";
export const WORKSPACE_API_PATH = "/api/workspaces";
/** The claim call must never delay a local-first boot for long. */
export const CLAIM_TIMEOUT_MS = 2500;

/** Matches the collab HTTP server's default port. */
const DEFAULT_HTTP_URL = "http://localhost:1235";
const OWNER_KEY_BYTES = 32;

export type ClaimStatus = "claimed" | "conflict" | "offline";

export interface OwnerSession {
  ownerKey: string;
  claim: ClaimStatus;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function httpBase(): string {
  const configured = import.meta.env.VITE_COLLAB_HTTP_URL as string | undefined;
  return (configured ?? DEFAULT_HTTP_URL).replace(/\/+$/, "");
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
  const url = `${httpBase()}${WORKSPACE_API_PATH}/${encodeURIComponent(workspaceId)}/claim`;
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
