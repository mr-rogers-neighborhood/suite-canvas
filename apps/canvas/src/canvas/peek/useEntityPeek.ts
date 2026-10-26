import type { Target } from "@suite/graph";
import { useCallback } from "react";
import { useCardTitles } from "../../hooks/useReferenceCounts";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { resolvePeek } from "./peekResolver";
import { type PeekController, usePeek } from "./usePeek";

/**
 * The snapshot-bound peek: one resolver built from the live workspace.
 *
 * Every surface that offers a peek uses this, so a card named in the outline and a card
 * named in a rollup read the same words. The snapshot is the same one the canvas draws
 * from, so a peek cannot describe a document nobody is looking at.
 */
export function useEntityPeek(): PeekController {
  const snapshot = useWorkspaceSnapshot();
  const titles = useCardTitles();

  const resolve = useCallback(
    (target: Target) =>
      resolvePeek(target, {
        cards: snapshot.cards,
        boards: snapshot.boards,
        sections: snapshot.sections,
        edges: snapshot.edges,
        placements: snapshot.placements,
        titles: new Map(titles.map((entry) => [entry.id, entry.title])),
        typeNames: new Map(snapshot.types.map((type) => [type.id, type.name])),
      }),
    [snapshot, titles],
  );

  return usePeek(resolve);
}
