import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { lockFileName } from "./paths.js";

/**
 * One writer per file.
 *
 * Two processes writing the same `.canvas` is the worst failure this product can
 * produce: Loro merges concurrent edits inside one document, but two documents
 * each holding a snapshot overwrite one another, and the loser's work is gone
 * with no error anywhere. So the second process is refused rather than warned.
 *
 * The lock is a file, because that is the only thing two processes share without
 * a server. It carries enough to tell a live lock from a dead one:
 *
 * - a **pid** and the **hostname**, because a pid is only meaningful on the
 *   machine that issued it;
 * - a **heartbeat** the holder refreshes, so a lock from a killed process goes
 *   stale rather than blocking forever;
 * - a **startedAt**, so a stale lock can name how long it has been there.
 *
 * It lives in the data directory, not beside the document: a document in a
 * synced folder would otherwise carry another machine's lock into every clone.
 */

/** Seconds without a heartbeat before a lock is treated as abandoned. */
export const STALE_AFTER_MS = 30_000;

/** How often a holder refreshes its heartbeat. */
export const HEARTBEAT_MS = 5_000;

export interface LockRecord {
  readonly appId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  /** Absolute path this lock guards, for the message a user reads. */
  readonly documentPath: string;
}

export type LockOutcome =
  | { readonly ok: true; readonly lock: FileLock }
  | { readonly ok: false; readonly reason: "held"; readonly holder: LockRecord };

export interface LockOptions {
  readonly appId?: string;
  /** Injected in tests; production reads the real clock. */
  readonly now?: () => number;
  readonly hostname?: string;
  readonly pid?: number;
  readonly staleAfterMs?: number;
}

function isLockRecord(value: unknown): value is LockRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.appId === "string" &&
    typeof record.pid === "number" &&
    typeof record.hostname === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.heartbeatAt === "string" &&
    typeof record.documentPath === "string"
  );
}

/**
 * Whether a lock left on disk still means someone is editing.
 *
 * A record from another machine is *not* treated as stale by heartbeat alone: a
 * clock difference or a sleeping laptop would then let two machines write. It is
 * only stale when it is unreadable, which means a write was interrupted.
 */
export function lockIsStale(
  record: LockRecord,
  options: { now: number; hostname: string; staleAfterMs?: number },
): boolean {
  if (record.hostname !== options.hostname) return false;
  const heartbeat = Date.parse(record.heartbeatAt);
  if (Number.isNaN(heartbeat)) return true;
  return options.now - heartbeat > (options.staleAfterMs ?? STALE_AFTER_MS);
}

/** Read a lock without deciding anything about it. */
export async function readLock(path: string): Promise<LockRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return isLockRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function write(record: LockRecord, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // A temp file then a rename, so a reader never sees half a record.
  const temp = `${path}.${record.pid}.tmp`;
  await writeFile(temp, JSON.stringify(record), { mode: 0o600 });
  await rename(temp, path);
}

/** A held lock. `release` is idempotent and safe to call from a quit handler. */
export interface FileLock {
  readonly path: string;
  readonly record: LockRecord;
  release(): Promise<void>;
}

/**
 * Take the lock for a document, or report who holds it.
 *
 * `locks` is the data directory's lock directory. The caller decides what to say
 * to the user; this only decides who may write.
 */
export async function acquireLock(
  documentPath: string,
  locks: string,
  options: LockOptions = {},
): Promise<LockOutcome> {
  const now = options.now ?? Date.now;
  const machine = options.hostname ?? hostname();
  const pid = options.pid ?? process.pid;
  const path = join(locks, lockFileName(documentPath));

  const existing = await readLock(path);
  if (existing) {
    if (
      !lockIsStale(existing, {
        now: now(),
        hostname: machine,
        ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs }),
      })
    ) {
      return { ok: false, reason: "held", holder: existing };
    }
    // Stale or unreadable: reclaim it. The rename below is the claim.
    await rm(path, { force: true }).catch(() => {
      // A lock that vanished between the read and the delete is already free.
    });
  }

  const stamp = new Date(now()).toISOString();
  const record: LockRecord = {
    appId: options.appId ?? "run.suite.canvas",
    pid,
    hostname: machine,
    startedAt: stamp,
    heartbeatAt: stamp,
    documentPath,
  };
  await write(record, path);

  // Re-read a moment later only to catch the narrow case where two processes
  // both cleared a stale lock and both wrote; the later writer wins, and the
  // earlier one must not proceed on the assumption it holds the file.
  const settled = await readLock(path);
  if (!settled || settled.pid !== record.pid || settled.startedAt !== record.startedAt) {
    return {
      ok: false,
      reason: "held",
      holder: settled ?? { ...record, pid: -1, hostname: "unknown" },
    };
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  const release = async (): Promise<void> => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    const current = await readLock(path);
    // Only remove the lock this instance wrote: a reclaimed lock belongs to
    // whoever reclaimed it.
    if (current && current.pid === record.pid && current.startedAt === record.startedAt) {
      await rm(path, { force: true });
    }
  };

  timer = setInterval(() => {
    void (async () => {
      const current = await readLock(path);
      if (!current || current.pid !== record.pid) return;
      await write({ ...current, heartbeatAt: new Date(now()).toISOString() }, path).catch(() => {
        // A failed heartbeat means the lock may go stale early; it does not
        // mean the write should stop.
      });
    })();
  }, HEARTBEAT_MS);
  // A heartbeat must not keep the process alive after the last window closes.
  timer.unref?.();

  return { ok: true, lock: { path, record, release } };
}

/** Whether a path exists as a regular file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
