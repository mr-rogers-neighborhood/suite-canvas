import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { HANDBOOK_REGION_ATTRIBUTE } from "./regions";

/**
 * What this screen can point at, as the keys the matcher compares.
 *
 * Three sources, deliberately: the document (cards and sections placed on the board in front of
 * the reader), the board itself, and the DOM (every shell region currently rendered). The DOM
 * is the honest answer for chrome — the inspector is present when it is open and absent when it
 * is not, which is exactly what "documented on this screen" should mean.
 *
 * A card elsewhere in the workspace is not present, and neither is a card on another board: the
 * handbook answers "what am I looking at", not "what does this workspace contain".
 */
export interface PresentTargets {
  /** `kind:id` keys for everything the matcher may consider present. */
  readonly present: ReadonlySet<string>;
  /** The region ids whose elements are in the DOM, for the picker and the empty state. */
  readonly regions: ReadonlySet<string>;
}

const EMPTY: PresentTargets = { present: new Set(), regions: new Set() };

/** The shell regions rendered right now. Two reads, one for presence and one for grouping. */
function readRegions(): Set<string> {
  if (typeof document === "undefined") return new Set();
  const found = document.querySelectorAll(`[${HANDBOOK_REGION_ATTRIBUTE}]`);
  const ids = new Set<string>();
  for (const element of found) {
    const id = element.getAttribute(HANDBOOK_REGION_ATTRIBUTE);
    if (id) ids.add(id);
  }
  return ids;
}

export function usePresentTargets(): PresentTargets {
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  // Surfaces open and close without a store change of their own (a dialog, a portal's panel),
  // so the DOM is re-read on a mutation. One frame of coalescing keeps a burst of React writes
  // from turning into a burst of reads.
  const [revision, setRevision] = useState(0);

  // The first read happens before sibling surfaces exist, so mount is a measurement of its own:
  // the pill's count should be right on the first paint rather than a frame later.
  useEffect(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setRevision((value) => value + 1);
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [HANDBOOK_REGION_ATTRIBUTE],
    });
    const onResize = () => setRevision((value) => value + 1);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the signal that the DOM changed, which is the whole point of this read.
  return useMemo(() => {
    if (!activeBoardId) return EMPTY;
    const present = new Set<string>();
    const placed = new Set(
      snapshot.placements
        .filter((placement) => placement.boardId === activeBoardId)
        .map((placement) => placement.cardId),
    );
    for (const card of snapshot.cards) {
      if (!card.deletedAt && placed.has(card.id)) present.add(`card:${card.id}`);
    }
    for (const section of snapshot.sections) {
      if (section.boardId === activeBoardId) present.add(`section:${section.id}`);
    }
    present.add(`board:${activeBoardId}`);

    const regions = readRegions();
    for (const id of regions) present.add(`ui:${id}`);
    return { present, regions };
  }, [snapshot, activeBoardId, revision]);
}
