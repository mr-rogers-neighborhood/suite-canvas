import { DatabaseSync, type StatementSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

/**
 * The write half of the document store, on its own thread.
 *
 * This file deliberately imports **nothing but Node built-ins**. It is started
 * with `new Worker(new URL("./persistenceWorker.ts", import.meta.url))`, so it
 * is loaded by whatever runs the server: `tsx` in the image, Node's own type
 * stripping in a bare checkout, or vitest's runner in a test. A relative import
 * would need a bundler to resolve `.js` back to `.ts`, and a worker is not
 * bundled — so the schema, the SQL and the connection pragmas arrive through
 * `workerData` from `persistence.ts` instead of being imported here.
 *
 * The thread is a *serial executor*: it applies batches in the order they
 * arrive, each batch inside one transaction, and it is the only writer to the
 * database. That single ownership is what makes "a write that lands out of
 * order" impossible rather than unlikely — see `persistenceWriter.ts`.
 */

export interface PersistenceWorkerOp {
  /** Host-assigned sequence number, echoed back so the host can retire state. */
  seq: number;
  /** `save` upserts a row; `delete` removes one. */
  kind: "save" | "delete";
  name: string;
  /** Snapshot bytes for a `save`; absent for a `delete`. */
  state?: Uint8Array;
  /** Epoch milliseconds recorded with the row. */
  updatedAt: number;
}

export type PersistenceHostMessage =
  | { type: "batch"; id: number; ops: PersistenceWorkerOp[] }
  | { type: "close" };

export type PersistenceWorkerReply =
  | { type: "ack"; id: number; seq: number; applied: number }
  | { type: "error"; id: number; seq: number; message: string }
  | { type: "closed" };

export interface PersistenceWorkerData {
  path: string;
  /** `PRAGMA` and DDL statements, in order, run once before the first batch. */
  setup: readonly string[];
  /** SQL of the two statements the host may send. */
  statements: { save: string; remove: string };
  /** `SharedArrayBuffer` counters: `[appliedBatches, closed, failed, rows]`. */
  signal: SharedArrayBuffer;
}

const data = workerData as PersistenceWorkerData;
const signal = new Int32Array(data.signal);

/**
 * Reports a failure through the signal buffer *and* the message channel.
 *
 * Both are needed: the host blocks on the buffer while it flushes, so a message
 * alone would leave it waiting for a thread that will never answer; and the
 * buffer alone cannot say what went wrong.
 */
function fail(seq: number, error: unknown): void {
  Atomics.store(signal, 2, 1);
  Atomics.notify(signal, 2);
  parentPort?.postMessage({
    type: "error",
    id: 0,
    seq,
    message: error instanceof Error ? error.message : String(error),
  } satisfies PersistenceWorkerReply);
}

let db: DatabaseSync;
const statements: { save: StatementSync; remove: StatementSync } = {
  save: null as unknown as StatementSync,
  remove: null as unknown as StatementSync,
};
try {
  db = new DatabaseSync(data.path);
  for (const statement of data.setup) db.exec(statement);
  statements.save = db.prepare(data.statements.save);
  statements.remove = db.prepare(data.statements.remove);
} catch (error) {
  // A store that cannot be opened is the host's fallback to decide on; this
  // thread only has to say so, quickly and unambiguously.
  fail(0, error);
  throw error;
}

/**
 * Applies one batch inside a transaction. All or nothing: a failure rolls the
 * batch back and reports the sequence number that broke, so the host can replay
 * the batch in order on the main thread instead of leaving a half-applied one.
 */
function apply(message: Extract<PersistenceHostMessage, { type: "batch" }>): void {
  let applied = 0;
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const op of message.ops) {
      if (op.kind === "save") {
        statements.save.run(op.name, op.state ?? new Uint8Array(), op.updatedAt);
      } else {
        statements.remove.run(op.name);
      }
      applied += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A connection that cannot roll back is already unusable; the host is
      // told either way and replays the batch on its own thread.
    }
    fail(message.ops[applied]?.seq ?? 0, error);
    return;
  }
  const seq = message.ops.at(-1)?.seq ?? 0;
  Atomics.add(signal, 0, 1);
  Atomics.add(signal, 3, applied);
  Atomics.notify(signal, 0);
  parentPort?.postMessage({
    type: "ack",
    id: message.id,
    seq,
    applied,
  } satisfies PersistenceWorkerReply);
}

parentPort?.on("message", (message: PersistenceHostMessage) => {
  if (message.type === "close") {
    try {
      db.close();
    } finally {
      Atomics.store(signal, 1, 1);
      Atomics.notify(signal, 1);
      parentPort?.postMessage({ type: "closed" } satisfies PersistenceWorkerReply);
    }
    return;
  }
  apply(message);
});
