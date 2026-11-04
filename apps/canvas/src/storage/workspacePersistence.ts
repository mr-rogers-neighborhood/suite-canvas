import type { LoroDoc } from "loro-crdt";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";
import type { HostKind } from "../host/bridge";

/**
 * Where the local copy of a document lives.
 *
 * The app has always kept its local copy in IndexedDB, and the desktop build
 * needs the same thing in a file the user owns. Rather than teach every caller
 * both, the store talks to this port and the host decides what implements it.
 * The port is three methods because three methods are all the store uses: the
 * leadership and compaction behaviour stays inside the IndexedDB adapter, where
 * multi-tab coordination belongs.
 *
 * Nothing above the port learns which adapter it received.
 */
export interface WorkspacePersistence {
  /** Hydrate the document from the local copy, including anything appended. */
  load(): Promise<void>;
  /** Write what is pending and resolve once it is durable. */
  flush(): Promise<void>;
  /** Stop observing and release whatever this instance holds. */
  destroy(): void;
}

export interface PersistenceRequest {
  readonly host: HostKind;
  /** The room this tab edits. Null means the page has no workspace to persist. */
  readonly roomId: string | null;
  readonly doc: LoroDoc;
  /** Whether this environment has IndexedDB at all. */
  readonly indexedDb: boolean;
}

/**
 * The persistence for this host, or null when the page has nothing to persist.
 *
 * A desktop build without a file store is not allowed to fall back to memory: a
 * session that silently persists nowhere is the one failure this product cannot
 * accept, so it fails loudly instead.
 */
export function createWorkspacePersistence(
  request: PersistenceRequest,
): WorkspacePersistence | null {
  if (request.roomId === null) return null;

  if (request.host === "desktop") {
    throw new Error(
      "desktop persistence is not wired yet: the file store arrives with the desktop shell, " +
        "and a desktop build must not run with the document kept only in memory.",
    );
  }

  if (!request.indexedDb) return null;
  return new LoroIndexeddbPersistence(request.roomId, request.doc);
}
