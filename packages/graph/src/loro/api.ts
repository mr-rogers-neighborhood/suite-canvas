import { boardsMethods } from "./boards.js";
import { cardsMethods } from "./cards/index.js";
import { cardTypesMethods } from "./cardTypes.js";
import type { DocContext } from "./context.js";
import { drawingsMethods } from "./drawings.js";
import { edgesMethods } from "./edges.js";
import { placementsMethods } from "./placements.js";
import { sectionsMethods } from "./sections.js";
import { snapshotMethods } from "./snapshot.js";
import { tagsMethods } from "./tags.js";
import { undoMethods } from "./undo.js";
import { viewsMethods } from "./views.js";
import { workspaceMethods } from "./workspace.js";

/**
 * Owns the composition of the document's domains: one bag of methods per domain,
 * built over a shared `DocContext`, and the wiring that lets a module call
 * another's public methods through `ctx.api`.
 */
export interface DocApi {
  undo: ReturnType<typeof undoMethods>;
  workspace: ReturnType<typeof workspaceMethods>;
  boards: ReturnType<typeof boardsMethods>;
  views: ReturnType<typeof viewsMethods>;
  cardTypes: ReturnType<typeof cardTypesMethods>;
  tags: ReturnType<typeof tagsMethods>;
  sections: ReturnType<typeof sectionsMethods>;
  cards: ReturnType<typeof cardsMethods>;
  placements: ReturnType<typeof placementsMethods>;
  edges: ReturnType<typeof edgesMethods>;
  drawings: ReturnType<typeof drawingsMethods>;
  snapshot: ReturnType<typeof snapshotMethods>;
}

export function createDocApi(ctx: DocContext): DocApi {
  const api: DocApi = {
    undo: undoMethods(ctx),
    workspace: workspaceMethods(ctx),
    boards: boardsMethods(ctx),
    views: viewsMethods(ctx),
    cardTypes: cardTypesMethods(ctx),
    tags: tagsMethods(ctx),
    sections: sectionsMethods(ctx),
    cards: cardsMethods(ctx),
    placements: placementsMethods(ctx),
    edges: edgesMethods(ctx),
    drawings: drawingsMethods(ctx),
    snapshot: snapshotMethods(ctx),
  };
  ctx.api = api;
  return api;
}
