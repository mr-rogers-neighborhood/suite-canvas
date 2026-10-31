import { Worker } from "node:worker_threads";

/**
 * The document store's write path, moved off the event loop.
 *
 * `persistence.ts` keeps a connection for the read path; every *write* is
 * appended here and executed by `persistenceWorker.ts` on its own thread. The
 * reason is the shape of the write: a save is a full-state upsert of the whole
 * snapshot, so on a large board it is the one operation that can hold the event
 * loop for longer than a frame, and everything else the relay does (socket
 * frames, presence, projection rebuilds) waits behind it.
 *
 * ## How ordering is preserved
 *
 * A write that lands out of order is data loss, so ordering is not left to
 * timing:
 *
 * - The host assigns every write a monotonic `seq` **in call order**, before it
 *   is queued. The sequence is the order the server accepted the writes in.
 * - Writes are handed to the worker as batches, and the worker applies batches
 *   in arrival order on one thread, each inside one transaction. There is one
 *   writer connection for the life of the process, so SQLite sees the writes in
 *   exactly the order the host numbered them.
 * - Batches are never re-sent, reordered or dropped. A worker that fails is not
 *   replaced: the queue degrades to applying writes inline on the main thread,
 *   in sequence order, through the same statements — a slower writer, never a
 *   different one.
 *
 * ## What a caller sees
 *
 * `append` is fire-and-forget, so a read that follows a write in the same tick
 * must not read the database: `pending()` answers from the accepted-but-not-yet
 * -durable overlay, and `persistence.ts` consults it first. An entry leaves the
 * overlay only once the worker has acknowledged the batch that contains it, at
 * which point the row is on disk and the read connection sees it.
 *
 * `flush()` blocks (on `Atomics.wait`) until every write accepted so far is
 * durable, which is what `close()` needs: a store closes with its writes on
 * disk, or it reports that it could not.
 */

export type DocumentWriteKind = "save" | "delete" | "update";

/** One accepted write: a snapshot to store, an incremental update, or `null` to delete the row. */
export interface DocumentWrite {
  kind?: DocumentWriteKind;
  name: string;
  /** Tagged snapshot bytes for a save; `null` for a delete; absent for an update. */
  state?: Uint8Array | null;
  /** Incremental delta update bytes for an update. */
  updateData?: Uint8Array;
  /** Epoch milliseconds recorded with the row. */
  updatedAt: number;
}

/** The statement-level writer a degraded queue falls back to. */
export interface InlineWriter {
  save: (name: string, state: Uint8Array, updatedAt: number) => void;
  remove: (name: string) => void;
  appendUpdate?: (name: string, updateData: Uint8Array, createdAt: number) => void;
}

export interface DocumentWriteQueueOptions {
  path: string;
  /** SQL of the statements, handed to the worker so it holds no schema. */
  statements: {
    save: string;
    remove: string;
    appendUpdate?: string;
    truncateUpdates?: string;
  };
  /** Pragmas and DDL the worker runs once, before its first batch. */
  setup: readonly string[];
  /** The statements, executed on the main thread if the worker fails. */
  inline: InlineWriter;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  /** Called after a batch is durable, with the number of rows it carried. */
  onWritten?: (rows: number) => void;
  /** `inline` skips the thread entirely; used by `:memory:` stores and tests. */
  mode?: "worker" | "inline";
}

export interface DocumentWriteStats {
  /** Where writes are executing right now. `inline` is the degraded path. */
  mode: "worker" | "inline";
  /** Batches accepted and not yet acknowledged. */
  queued: number;
  /** Rows made durable, or applied inline after a degradation. */
  applied: number;
  /** Batches or rows that failed; the queue degraded on a batch failure. */
  failed: number;
  /** Bytes held in the pending overlay, for the memory gauge. */
  pendingBytes: number;
}

export interface DocumentWriteQueue {
  append: (write: DocumentWrite) => void;
  /** The accepted write for a name that is not durable yet, if there is one. */
  pending: (name: string) => DocumentWrite | undefined;
  /** Every name with an accepted write that is not durable yet. */
  pendingAll: () => ReadonlyMap<string, DocumentWrite>;
  /** Whether there are pending incremental delta updates for this name. */
  hasPendingUpdates: (name: string) => boolean;
  /** Blocks until every write accepted so far is on disk. */
  flush: () => void;
  close: () => void;
  stats: () => DocumentWriteStats;
}

/** How long `flush` and `close` wait for the writer before they give up. */
export const FLUSH_TIMEOUT_MS = 10_000;

interface Queued {
  seq: number;
  write: DocumentWrite;
}

interface Batch {
  id: number;
  ops: Queued[];
}

export function createDocumentWriteQueue(options: DocumentWriteQueueOptions): DocumentWriteQueue {
  const pending = new Map<string, Queued>();
  /** Batches posted and not yet acknowledged, oldest first. */
  const flights: Batch[] = [];
  let queue: Queued[] = [];
  let nextSeq = 1;
  let nextBatchId = 0;
  let lastPostedSeq = 0;
  let applied = 0;
  let failed = 0;
  let closed = false;

  /** `[0]` batches applied, `[1]` writer closed, `[2]` writer failed, `[3]` rows. */
  const signal = new Int32Array(new SharedArrayBuffer(16));
  let worker: Worker | null = null;
  let mode: "worker" | "inline" =
    options.mode ?? (options.path === ":memory:" ? "inline" : "worker");

  /** Rows already reported to `onWritten`, so a flushed batch is counted once. */
  let reportedRows = 0;

  /**
   * Reports rows the writer has made durable. The count comes from the shared
   * buffer rather than from the acknowledgement message, because `flush` blocks
   * this thread: the message that would have carried it is only delivered after
   * the block ends, and the number has to be right when `flush` returns.
   */
  function reportWritten(): void {
    const total = Atomics.load(signal, 3);
    const rows = total - reportedRows;
    if (rows <= 0) return;
    reportedRows = total;
    options.onWritten?.(rows);
  }

  const writeInline = (write: DocumentWrite): void => {
    const kind =
      write.kind ??
      (write.state === null ? "delete" : write.updateData !== undefined ? "update" : "save");
    if (kind === "save") {
      options.inline.save(write.name, write.state ?? new Uint8Array(), write.updatedAt);
    } else if (kind === "update") {
      options.inline.appendUpdate?.(
        write.name,
        write.updateData ?? new Uint8Array(),
        write.updatedAt,
      );
    } else {
      options.inline.remove(write.name);
    }
  };

  /**
   * Drops overlay entries the writer has taken responsibility for. `seq` is the
   * highest acknowledged sequence number, so everything at or below it is on
   * disk and the read connection is authoritative for those names again.
   */
  function retire(seq: number): void {
    for (const [name, entry] of pending) {
      if (entry.seq <= seq) pending.delete(name);
    }
  }

  /** Applies everything still queued on this thread, in sequence order. */
  function drainInline(): void {
    const ops = queue;
    queue = [];
    let rows = 0;
    for (const op of ops) {
      try {
        writeInline(op.write);
        applied += 1;
        rows += 1;
        retire(op.seq);
      } catch (error) {
        failed += 1;
        options.warn("inline document write failed", {
          code: "persistence-write-failed",
          name: op.write.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (rows > 0) options.onWritten?.(rows);
  }

  /** Falls back to inline writes once, keeping the queue and its order. */
  function degrade(reason: string): void {
    if (mode === "inline" || closed) return;
    mode = "inline";
    failed += 1;
    // Batches the writer had but did not acknowledge go back at the front, in
    // the order they were posted, so the inline path replays the same sequence.
    queue = [...flights.flatMap((batch) => batch.ops), ...queue];
    flights.length = 0;
    options.warn("document writes moved to the main thread", {
      code: "persistence-writer-fallback",
      reason,
      pending: queue.length,
    });
    const abandoned = worker;
    worker = null;
    if (abandoned) void abandoned.terminate().catch(() => undefined);
    drainInline();
  }

  /** Keeps the process alive only while a write is outstanding. */
  function settle(): void {
    if (queue.length === 0 && flights.length === 0) worker?.unref();
  }

  function post(): void {
    if (worker === null || queue.length === 0) return;
    nextBatchId += 1;
    const batch: Batch = { id: nextBatchId, ops: queue };
    queue = [];
    flights.push(batch);
    lastPostedSeq = batch.ops.at(-1)?.seq ?? lastPostedSeq;
    worker.ref();
    worker.postMessage({
      type: "batch",
      id: batch.id,
      ops: batch.ops.map((op) => ({
        seq: op.seq,
        kind:
          op.write.kind ??
          (op.write.state === null
            ? ("delete" as const)
            : op.write.updateData !== undefined
              ? ("update" as const)
              : ("save" as const)),
        name: op.write.name,
        state: op.write.state ?? undefined,
        updateData: op.write.updateData,
        updatedAt: op.write.updatedAt,
      })),
    });
  }

  /** Posts whatever is queued, at most once per turn of the loop. */
  function schedule(): void {
    if (worker === null) return;
    setImmediate(() => {
      if (worker === null) return;
      post();
      settle();
    }).unref();
  }

  function onAck(message: { id: number; rows: number; seq: number }): void {
    // Batches are acknowledged in the order they were posted, one per batch.
    const [oldest] = flights;
    if (oldest !== undefined && oldest.id === message.id) flights.shift();
    applied += message.rows;
    retire(message.seq);
    reportWritten();
    if (queue.length > 0) post();
    settle();
  }

  /**
   * Blocks the calling thread until the counter at `index` reaches `target`, or
   * the writer reports that it failed.
   *
   * The worker notifies the buffer directly, so the wait does not depend on this
   * thread's event loop running — which is the point: it is blocked. The same
   * reason makes the failure flag part of the wait: a message alone would only
   * be delivered after the block ends, so a writer that could not open the store
   * would cost the full timeout at every flush.
   */
  function waitFor(index: number, target: number, timeoutMs: number): boolean {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = Atomics.load(signal, index);
      if (current >= target) return true;
      if (Atomics.load(signal, 2) === 1) return false;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      Atomics.wait(signal, index, current, Math.min(remaining, 100));
    }
  }

  if (mode === "worker") {
    try {
      const started = new Worker(new URL("./persistenceWorker.ts", import.meta.url), {
        workerData: {
          path: options.path,
          setup: options.setup,
          statements: options.statements,
          signal: signal.buffer,
        },
      });
      started.unref();
      started.on("message", (message: unknown) => {
        const reply = message as
          | { type: "ack"; id: number; seq: number; applied: number }
          | { type: "error"; id: number; seq: number; message: string }
          | { type: "closed" };
        if (reply.type === "ack") {
          onAck({ id: reply.id, rows: reply.applied, seq: reply.seq });
          return;
        }
        if (reply.type === "error") {
          failed += 1;
          degrade(`batch ${String(reply.id)} failed: ${reply.message}`);
        }
      });
      started.on("error", (error: Error) => degrade(`writer error: ${error.message}`));
      started.on("exit", (code: number) => {
        if (closed) return;
        degrade(`writer exited with code ${String(code)}`);
      });
      worker = started;
    } catch (error) {
      degrade(`writer could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    append: (write) => {
      const entry: Queued = { seq: nextSeq, write };
      nextSeq += 1;
      pending.set(write.name, entry);
      queue.push(entry);
      if (mode === "inline") {
        drainInline();
        return;
      }
      // Hold the process open from the moment a write is accepted, not from the
      // moment it is posted: a save must not be lost to an idle event loop.
      worker?.ref();
      schedule();
    },
    pending: (name) => pending.get(name)?.write,
    pendingAll: () => {
      const view = new Map<string, DocumentWrite>();
      for (const [name, entry] of pending) view.set(name, entry.write);
      return view;
    },
    hasPendingUpdates: (name) => {
      const isPendingUpdate = (write: DocumentWrite) =>
        write.name === name && (write.kind === "update" || write.updateData !== undefined);
      return (
        queue.some((op) => isPendingUpdate(op.write)) ||
        flights.some((batch) => batch.ops.some((op) => isPendingUpdate(op.write)))
      );
    },
    flush: () => {
      if (closed) return;
      if (mode === "inline" || worker === null) {
        if (mode === "worker") degrade("no writer thread");
        drainInline();
        return;
      }
      post();
      const target = nextBatchId;
      if (target === 0) return;
      if (!waitFor(0, target, FLUSH_TIMEOUT_MS)) {
        if (Atomics.load(signal, 2) === 1) {
          degrade("writer reported a failure");
          return;
        }
        failed += 1;
        options.warn("timed out waiting for document writes to reach disk", {
          code: "persistence-flush-timeout",
          pending: pending.size,
          timeoutMs: FLUSH_TIMEOUT_MS,
        });
        return;
      }
      // The queue drained without this thread's event loop running, so the
      // acknowledgements are retired here rather than by a message handler.
      flights.length = 0;
      retire(lastPostedSeq);
      reportWritten();
    },
    close: () => {
      if (closed) return;
      if (mode === "worker" && worker !== null) {
        post();
        const target = nextBatchId;
        if (target > 0 && waitFor(0, target, FLUSH_TIMEOUT_MS)) {
          flights.length = 0;
          retire(lastPostedSeq);
          reportWritten();
        } else if (Atomics.load(signal, 2) === 1) {
          // The thread will not take the rest; the inline path below writes it.
          degrade("writer reported a failure");
        }
      }
      // Anything the writer never acknowledged is written here, in order.
      drainInline();
      closed = true;
      const stopping = worker;
      worker = null;
      if (stopping === null) return;
      stopping.postMessage({ type: "close" });
      // The writer closes its own connection and reports back through the
      // signal buffer; the wait is bounded and termination is the backstop.
      waitFor(1, 1, FLUSH_TIMEOUT_MS);
      void stopping.terminate().catch(() => undefined);
    },
    stats: () => {
      let pendingBytes = 0;
      for (const entry of pending.values()) {
        pendingBytes +=
          (entry.write.state?.byteLength ?? 0) + (entry.write.updateData?.byteLength ?? 0);
      }
      return {
        mode,
        queued: queue.length + flights.length,
        applied,
        failed,
        pendingBytes,
      };
    },
  };
}
