import type { Section } from "@suite/graph";
import type { Node } from "@xyflow/react";
import { type RefObject, useCallback, useRef } from "react";
import type { SectionDragState } from "../../collab/presence";
import { useUiStore } from "../../store/useUiStore";

/**
 * A section riding a card drag.
 *
 * A section is not a React Flow node, so a drag that carries one reports nothing about it: the frame
 * would sit still while the cards it holds slid away, and then jump into place on the drop. The
 * translation comes from the anchor card, so easing, snapping and a pointer that leaves the pane all
 * resolve to the answer the commit will use.
 *
 * Two readers, one source: `useUiStore.dragFollow` paints the frame in this window (the section
 * offsets are resolved above the surface that sees the drag, which is why it is store state), and
 * `setSectionDrag` tells peers through presence.
 */
export function useDragFollow(input: {
  sections: readonly Section[];
  /** The frames to carry, when the reader has some selected alongside the cards. */
  selectedSectionIds: readonly string[];
  /** The nodes React Flow is moving: their positions are committed from the nodes, not from here. */
  draggedNodeIds: RefObject<readonly string[]>;
  setSectionDragPresence: (state: SectionDragState | null) => void;
}) {
  const { sections, selectedSectionIds, draggedNodeIds, setSectionDragPresence } = input;
  const anchor = useRef<{ sectionIds: readonly string[]; x: number; y: number } | null>(null);

  const end = useCallback(() => {
    anchor.current = null;
    useUiStore.getState().setDragFollow(null);
    setSectionDragPresence(null);
  }, [setSectionDragPresence]);

  /** Seeded on the first frame, so the drag never starts one frame behind the pointer. */
  const begin = useCallback(
    (node: Node) => {
      const frames = selectedSectionIds.filter((id) =>
        sections.some((section) => section.id === id),
      );
      if (frames.length === 0) {
        end();
        return;
      }
      anchor.current = { sectionIds: frames, x: node.position.x, y: node.position.y };
      useUiStore.getState().setDragFollow({
        sectionIds: frames,
        dx: 0,
        dy: 0,
        carrying: [...draggedNodeIds.current],
      });
    },
    [end, selectedSectionIds, sections, draggedNodeIds],
  );

  const follow = useCallback(
    (node: Node) => {
      const start = anchor.current;
      if (!start) return;
      const dx = node.position.x - start.x;
      const dy = node.position.y - start.y;
      useUiStore.getState().setDragFollow({
        sectionIds: start.sectionIds,
        dx,
        dy,
        carrying: [...draggedNodeIds.current],
      });
      // The whole set travels: `sectionId` names the outermost frame for a client that predates the
      // list, and `sectionIds` is what a peer's paint uses to move every frame at once.
      const primary = sections.find((section) => section.id === start.sectionIds[0]);
      if (primary) {
        setSectionDragPresence({
          sectionId: primary.id,
          position: { x: primary.x + dx, y: primary.y + dy },
          sectionIds: [...start.sectionIds],
        });
      }
    },
    [sections, draggedNodeIds, setSectionDragPresence],
  );

  return { begin, follow, end };
}
