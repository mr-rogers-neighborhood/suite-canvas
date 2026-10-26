import type { Value } from "loro-crdt";
import type { DocContext } from "./context.js";
import type { WorkspaceChange } from "./model.js";

/**
 * Owns the document's boundaries: the change subscription that fans events to caches
 * and listeners, and the Loro update, snapshot and JSON exports a provider or a test reads.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function snapshotMethods(ctx: DocContext) {
  return {
    observe(onChange: (change: WorkspaceChange) => void): () => void {
      ctx.listeners.add(onChange);
      return () => {
        ctx.listeners.delete(onChange);
      };
    },

    /** Raw Loro update bytes for a provider. */
    exportUpdate(): Uint8Array {
      return ctx.doc.export({ mode: "update" });
    },

    importUpdate(update: Uint8Array): void {
      ctx.doc.import(update);
    },

    exportSnapshot(): Uint8Array {
      return ctx.doc.export({ mode: "snapshot" });
    },

    importSnapshot(snapshot: Uint8Array): void {
      ctx.doc.import(snapshot);
    },

    /** Test/debug helper: all values, for parity checks. */
    toJSON(): Record<string, Value> {
      return ctx.doc.toJSON() as Record<string, Value>;
    },
  };
}
