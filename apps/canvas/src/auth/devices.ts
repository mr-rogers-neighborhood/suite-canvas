/**
 * Devices and sessions.
 *
 * A Better Auth session is one signed-in browser. Listing them is how someone
 * notices a device they do not recognise, and revoking one is the only remote
 * sign-out this product has: revoking drops the row, so the device's next token
 * mint fails and its socket dies within the JWT's five-minute TTL (ADR-0074).
 *
 * Nothing here reads a password, a token or a fingerprint: what the list shows is
 * what the server recorded — when the session started, when it was last used, and
 * the user agent it arrived with.
 */

import { authClient } from "./client";

export interface DeviceSession {
  /** Opaque session token; the handle a revoke names. Never displayed. */
  id: string;
  /** Epoch milliseconds. */
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number | null;
  /** Raw user agent, shortened for display by {@link deviceLabel}. */
  userAgent: string | null;
  ipAddress: string | null;
  /** True for the session making this request. */
  current: boolean;
}

export type DevicesResult<T> = { ok: true; value: T } | { ok: false; message: string };

function milliseconds(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Every signed-in browser on this account, most recently used first. */
export async function listDevices(): Promise<DevicesResult<DeviceSession[]>> {
  try {
    const listed = await authClient.listSessions();
    if (listed.error || !Array.isArray(listed.data)) {
      return { ok: false, message: "Your sessions could not be read." };
    }
    // The token of the session making this request, so the list can say "this
    // device" without asking the reader to guess from an IP address.
    let current: string | null = null;
    try {
      const session = await authClient.getSession();
      const token = (session.data as { session?: { token?: unknown } } | null)?.session?.token;
      if (typeof token === "string") current = token;
    } catch {
      // An unreadable session only costs the "this device" label.
    }
    const rows = listed.data.flatMap((entry): DeviceSession[] => {
      const id = typeof entry.token === "string" ? entry.token : null;
      if (id === null) return [];
      return [
        {
          id,
          createdAt: milliseconds(entry.createdAt),
          updatedAt: milliseconds(entry.updatedAt),
          expiresAt: milliseconds(entry.expiresAt),
          userAgent: typeof entry.userAgent === "string" ? entry.userAgent : null,
          ipAddress: typeof entry.ipAddress === "string" ? entry.ipAddress : null,
          current: entry.token === current,
        },
      ];
    });
    return {
      ok: true,
      value: rows.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
    };
  } catch {
    return { ok: false, message: "Your sessions could not be read." };
  }
}

/** Signs one other browser out. The current one is refused by the panel, not here. */
export async function revokeDevice(token: string): Promise<DevicesResult<true>> {
  try {
    const result = await authClient.revokeSession({ token });
    if (result.error) return { ok: false, message: "That device could not be signed out." };
    return { ok: true, value: true };
  } catch {
    return { ok: false, message: "That device could not be signed out." };
  }
}

/** Signs out every browser except this one. */
export async function revokeOtherDevices(): Promise<DevicesResult<true>> {
  try {
    const result = await authClient.revokeOtherSessions();
    if (result.error) return { ok: false, message: "The other devices could not be signed out." };
    return { ok: true, value: true };
  } catch {
    return { ok: false, message: "The other devices could not be signed out." };
  }
}

/**
 * A readable device name from a user agent, without a parser dependency.
 *
 * It is a label, not a fingerprint: an unknown agent is shown as "A browser"
 * rather than guessed at, and the panel always has the timestamps beside it.
 */
export function deviceLabel(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim().length === 0) return "A browser";
  const ua = userAgent;
  const browser = /Edg\//u.test(ua)
    ? "Edge"
    : /Firefox\//u.test(ua)
      ? "Firefox"
      : /Chrome\//u.test(ua)
        ? "Chrome"
        : /Safari\//u.test(ua)
          ? "Safari"
          : null;
  const system = /Windows/u.test(ua)
    ? "Windows"
    : /Mac OS X/u.test(ua)
      ? "macOS"
      : /Android/u.test(ua)
        ? "Android"
        : /iPhone|iPad/u.test(ua)
          ? "iOS"
          : /Linux/u.test(ua)
            ? "Linux"
            : null;
  if (browser === null && system === null) return "A browser";
  if (browser === null) return `A browser on ${system}`;
  return system === null ? browser : `${browser} on ${system}`;
}
