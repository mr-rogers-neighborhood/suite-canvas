import { WorkspaceDocument } from "@suite/graph";
import * as Y from "yjs";

export interface DocStats {
  /** Encoded size of the whole document, in bytes. */
  bytes: number;
  boards: number;
  cards: number;
  placements: number;
  edges: number;
}

/**
 * Size and shape of the workspace document. `encodeStateAsUpdate` walks the
 * whole document, so dev callers should refresh at overlay speed (~1s), never
 * per render.
 */
export function readDocStats(workspace: WorkspaceDocument): DocStats {
  const { doc } = workspace;
  return {
    bytes: Y.encodeStateAsUpdate(doc).byteLength,
    boards: doc.getMap<unknown>(WorkspaceDocument.BOARDS_KEY).size,
    cards: doc.getMap<unknown>(WorkspaceDocument.CARDS_KEY).size,
    placements: doc.getMap<unknown>(WorkspaceDocument.PLACEMENTS_KEY).size,
    edges: doc.getMap<unknown>(WorkspaceDocument.EDGES_KEY).size,
  };
}
