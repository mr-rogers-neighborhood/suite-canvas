import type { IncomingMessage } from "node:http";

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets; only meaningful when `ok` is false. */
  retryAfter: number;
}

export interface RateLimiter {
  take: (key: string) => RateLimitResult;
  reset: () => void;
}

/**
 * A small fixed-window limiter for a single server process. The app is
 * deliberately single-instance (SQLite and in-memory rooms), so this is the
 * whole rate-limit story; a multi-replica deployment would need a shared store.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const prune = (at: number): void => {
    if (hits.size < 1024) return;
    for (const [key, entry] of hits) {
      if (entry.resetAt <= at) hits.delete(key);
    }
  };

  return {
    take: (key) => {
      const at = now();
      prune(at);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= at) {
        hits.set(key, { count: 1, resetAt: at + windowMs });
        return { ok: true, retryAfter: 0 };
      }
      entry.count += 1;
      if (entry.count <= limit) return { ok: true, retryAfter: 0 };
      return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) };
    },
    reset: () => hits.clear(),
  };
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The HTTP peer, or the first proxy hop when the deployment says to trust it. */
export function clientAddress(request: IncomingMessage): string {
  if (process.env.SUITE_TRUST_PROXY === "1") {
    const forwarded = request.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? "unknown";
}

export const claimLimiter = createRateLimiter(envNumber("SUITE_CLAIM_RATE_LIMIT", 600), 60_000);
export const rotateLimiter = createRateLimiter(envNumber("SUITE_ROTATE_RATE_LIMIT", 10), 60_000);
export const shareResolveLimiter = createRateLimiter(
  envNumber("SUITE_SHARE_RESOLVE_RATE_LIMIT", 300),
  60_000,
);
export const shareCreateLimiter = createRateLimiter(
  envNumber("SUITE_SHARE_CREATE_RATE_LIMIT", 30),
  60_000,
);
export const publishLimiter = createRateLimiter(envNumber("SUITE_PUBLISH_RATE_LIMIT", 20), 60_000);

export function resetRateLimits(): void {
  for (const limiter of [
    claimLimiter,
    rotateLimiter,
    shareResolveLimiter,
    shareCreateLimiter,
    publishLimiter,
  ]) {
    limiter.reset();
  }
}
