import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocumentStore } from "./persistence.js";
import { createDocumentWriteQueue, type DocumentWrite } from "./persistenceWriter.js";

/**
 * The write path is the one place a bug is data loss, so the properties tested
 * here are about order and durability rather than speed:
 *
 * - a write accepted before another is applied before it, in every mode;
 * - a read after a write sees the write, even before the thread has answered;
 * - a store that closes with writes outstanding has them on disk;
 * - a writer thread that cannot start or dies leaves a working, ordered writer.
 */

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(import.meta.dirname, ".writer-test-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(state: Uint8Array | null): string | null {
  return state === null ? null : new TextDecoder().decode(state);
}

/** A queue driven by the real worker thread, with an inline writer that yells. */
function workerQueue(name = "documents.sqlite") {
  const applied: string[] = [];
  const warnings: string[] = [];
  const queue = createDocumentWriteQueue({
    path: join(directory, name),
    statements: {
      save: `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      remove: "DELETE FROM documents WHERE name = ?",
    },
    setup: [
      "PRAGMA busy_timeout = 5000",
      "PRAGMA journal_mode = WAL",
      "CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at INTEGER NOT NULL)",
    ],
    inline: {
      save: (key) => applied.push(`save:${key}`),
      remove: (key) => applied.push(`delete:${key}`),
    },
    warn: (message) => warnings.push(message),
  });
  return { queue, applied, warnings };
}

function write(name: string, value: string | null, at = 1): DocumentWrite {
  return { name, state: value === null ? null : bytes(value), updatedAt: at };
}

describe("document write queue", () => {
  it("runs on a worker thread for a file store", () => {
    const { queue } = workerQueue();
    try {
      expect(queue.stats().mode).toBe("worker");
    } finally {
      queue.close();
    }
  });

  it("answers a read from the accepted write before it is durable", () => {
    const { queue } = workerQueue();
    try {
      queue.append(write("%LOR:ws-1", "first"));
      queue.append(write("%LOR:ws-1", "second"));
      // Nothing has been acknowledged yet, so this is the overlay answering.
      expect(decode(queue.pending("%LOR:ws-1")?.state ?? null)).toBe("second");
    } finally {
      queue.close();
    }
  });

  it("applies a burst of writes in the order they were accepted", () => {
    const { queue } = workerQueue();
    try {
      for (let index = 0; index < 50; index += 1) {
        queue.append(write("%LOR:one", `value-${String(index)}`));
        queue.append(write(`%LOR:room-${String(index)}`, `room-${String(index)}`));
      }
      queue.flush();
      expect(queue.stats().failed).toBe(0);
      expect(queue.stats().queued).toBe(0);
    } finally {
      queue.close();
    }

    const store = createDocumentStore(join(directory, "documents.sqlite"));
    try {
      expect(decode(store.load("%LOR:one"))).toBe("value-49");
      for (let index = 0; index < 50; index += 1) {
        expect(decode(store.load(`%LOR:room-${String(index)}`))).toBe(`room-${String(index)}`);
      }
    } finally {
      store.close();
    }
  });

  it("orders a delete after the save that precedes it", () => {
    const { queue } = workerQueue();
    try {
      queue.append(write("%LOR:gone", "here"));
      queue.append(write("%LOR:gone", null));
      // The overlay answers the delete, so a load in the same tick agrees.
      expect(queue.pending("%LOR:gone")?.state).toBeNull();
      queue.close();
    } finally {
      queue.close();
    }

    const store = createDocumentStore(join(directory, "documents.sqlite"));
    try {
      expect(store.load("%LOR:gone")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("falls back to inline writes, in order, when the thread cannot start", () => {
    const applied: string[] = [];
    const warnings: string[] = [];
    const queue = createDocumentWriteQueue({
      // A directory that does not exist: `DatabaseSync` throws inside the worker.
      path: join(directory, "missing", "documents.sqlite"),
      statements: { save: "INSERT INTO documents VALUES (?, ?, ?)", remove: "DELETE 1" },
      setup: ["CREATE TABLE documents (name TEXT PRIMARY KEY, state BLOB, updated_at INTEGER)"],
      inline: {
        save: (key) => applied.push(`save:${key}`),
        remove: (key) => applied.push(`delete:${key}`),
      },
      warn: (message) => warnings.push(message),
    });
    try {
      queue.append(write("one", "a"));
      queue.append(write("two", "b"));
      queue.append(write("one", null));
      queue.flush();
      // The inline writer is a stand-in for the same statements on this thread;
      // the order it saw is the order the queue accepted.
      expect(warnings.length).toBeGreaterThan(0);
      expect(queue.stats().mode).toBe("inline");
      expect(applied).toEqual(["save:one", "save:two", "delete:one"]);
      expect(queue.stats().failed).toBeGreaterThan(0);
    } finally {
      queue.close();
    }
  });

  it("closes without leaving an accepted write in memory", () => {
    const store = createDocumentStore(join(directory, "documents.sqlite"));
    store.save("%LOR:ws-1", bytes("kept"));
    // No flush, no tick: `close` is the only thing that makes it durable.
    store.close();

    const reopened = createDocumentStore(join(directory, "documents.sqlite"));
    try {
      expect(decode(reopened.load("%LOR:ws-1"))).toBe("kept");
      expect(reopened.list().map((entry) => entry.name)).toEqual(["%LOR:ws-1"]);
    } finally {
      reopened.close();
    }
  });
});

describe("durability accounting", () => {
  it("reports rows only once they are on disk", () => {
    const written: number[] = [];
    const store = createDocumentStore(join(directory, "counted.sqlite"), {
      onWritten: (rows) => written.push(rows),
    });
    try {
      store.save("%LOR:ws-1", bytes("one"));
      store.save("%LOR:ws-2", bytes("two"));
      // Nothing has been applied yet: the counter must not run ahead of the disk.
      expect(written).toEqual([]);
      store.flush();
      expect(written.reduce((total, rows) => total + rows, 0)).toBe(2);
    } finally {
      store.close();
    }
  });
});
