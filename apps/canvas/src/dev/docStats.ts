import { WorkspaceDocument } from "@suite/graph";

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
    bytes: doc.export({ mode: "snapshot" }).byteLength,
    boards: doc.getMap(WorkspaceDocument.BOARDS_KEY).size,
    cards: doc.getMap(WorkspaceDocument.CARDS_KEY).size,
    placements: doc.getMap(WorkspaceDocument.PLACEMENTS_KEY).size,
    edges: doc.getMap(WorkspaceDocument.EDGES_KEY).size,
  };
}
