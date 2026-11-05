import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, type LockRecord, lockIsStale, readLock, STALE_AFTER_MS } from "./lock.js";

let locks = "";

beforeEach(async () => {
  locks = await mkdtemp(join(tmpdir(), "suite-locks-"));
});

afterEach(async () => {
  await rm(locks, { recursive: true, force: true });
});

const DOCUMENT = "/home/me/Documents/Suite/Canvas/Research.canvas";

describe("acquireLock", () => {
  it("takes a free lock and writes what a second process needs to see", async () => {
    const outcome = await acquireLock(DOCUMENT, locks, {
      hostname: "laptop",
      pid: 4242,
      now: () => Date.parse("2026-11-04T20:00:00.000Z"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const record = await readLock(outcome.lock.path);
    expect(record).toMatchObject({
      pid: 4242,
      hostname: "laptop",
      documentPath: DOCUMENT,
      startedAt: "2026-11-04T20:00:00.000Z",
    });
    await outcome.lock.release();
  });

  it("refuses a lock a live process holds", async () => {
    const first = await acquireLock(DOCUMENT, locks, { hostname: "laptop", pid: 1 });
    expect(first.ok).toBe(true);

    const second = await acquireLock(DOCUMENT, locks, { hostname: "laptop", pid: 2 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("held");
    expect(second.holder.pid).toBe(1);

    if (first.ok) await first.lock.release();
  });

  it("reclaims a lock whose heartbeat stopped", async () => {
    let now = Date.parse("2026-11-04T20:00:00.000Z");
    const first = await acquireLock(DOCUMENT, locks, {
      hostname: "laptop",
      pid: 1,
      now: () => now,
    });
    expect(first.ok).toBe(true);
    // Stop the heartbeat before pretending time passed.
    if (first.ok) await first.lock.release();

    // Write a record by hand that is older than the stale window.
    const path = first.ok ? first.lock.path : "";
    const stale: LockRecord = {
      appId: "run.suite.canvas",
      pid: 1,
      hostname: "laptop",
      startedAt: "2026-11-04T19:00:00.000Z",
      heartbeatAt: "2026-11-04T19:00:00.000Z",
      documentPath: DOCUMENT,
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(stale));

    now += STALE_AFTER_MS + 1000;
    const second = await acquireLock(DOCUMENT, locks, {
      hostname: "laptop",
      pid: 2,
      now: () => now,
    });
    expect(second.ok).toBe(true);
    if (second.ok) await second.lock.release();
  });

  it("removes the lock on release, leaving the directory empty", async () => {
    const outcome = await acquireLock(DOCUMENT, locks, { hostname: "laptop", pid: 1 });
    if (!outcome.ok) throw new Error("expected the lock");
    await outcome.lock.release();
    expect(await readdir(locks)).toEqual([]);
  });

  it("is safe to release twice", async () => {
    const outcome = await acquireLock(DOCUMENT, locks, { hostname: "laptop", pid: 1 });
    if (!outcome.ok) throw new Error("expected the lock");
    await outcome.lock.release();
    await expect(outcome.lock.release()).resolves.toBeUndefined();
  });

  it("does not let a release remove a lock someone else reclaimed", async () => {
    const outcome = await acquireLock(DOCUMENT, locks, { hostname: "laptop", pid: 1 });
    if (!outcome.ok) throw new Error("expected the lock");
    const path = outcome.lock.path;

    // Another process takes over the same path after our record is gone.
    await rm(path);
    const replacement = await acquireLock(DOCUMENT, locks, { hostname: "laptop", pid: 2 });
    expect(replacement.ok).toBe(true);

    await outcome.lock.release();
    const still = await readLock(path);
    expect(still?.pid).toBe(2);
    if (replacement.ok) await replacement.lock.release();
  });
});

describe("lockIsStale", () => {
  const record: LockRecord = {
    appId: "run.suite.canvas",
    pid: 1,
    hostname: "laptop",
    startedAt: "2026-11-04T20:00:00.000Z",
    heartbeatAt: "2026-11-04T20:00:00.000Z",
    documentPath: DOCUMENT,
  };

  it("is not stale while the heartbeat is fresh", () => {
    expect(
      lockIsStale(record, { now: Date.parse("2026-11-04T20:00:05.000Z"), hostname: "laptop" }),
    ).toBe(false);
  });

  it("is stale once the heartbeat is older than the window", () => {
    expect(
      lockIsStale(record, { now: Date.parse("2026-11-04T20:01:00.000Z"), hostname: "laptop" }),
    ).toBe(true);
  });

  it("is never stale when it came from another machine", () => {
    // A different clock or a sleeping laptop must not let two machines write.
    expect(
      lockIsStale(record, { now: Date.parse("2027-01-01T00:00:00.000Z"), hostname: "desktop" }),
    ).toBe(false);
  });

  it("is stale when the heartbeat cannot be read", () => {
    expect(
      lockIsStale(
        { ...record, heartbeatAt: "not a date" },
        { now: Date.now(), hostname: "laptop" },
      ),
    ).toBe(true);
  });
});
