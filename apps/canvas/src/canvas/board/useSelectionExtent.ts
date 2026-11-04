import type { Section } from "@suite/graph";
import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import type { SectionOffset } from "../sections/sectionLayout";
import { type SelectionExtent, selectionExtent } from "./selectionBounds";

/**
 * The box around everything selected, from what each layer already knows.
 *
 * Cards contribute their measured rects, which are live while they are dragged; frames their stored
 * rect with any live offset or resize applied; a link its two anchors, because a line has no area of
 * its own. Pure enough to memo on its inputs, and kept out of the surface because the surface is the
 * largest file in the board and this only reads.
 */
export function useSelectionExtent(input: {
  lookup: ReadonlyMap<string, Node>;
  sections: readonly Section[];
  offsets: ReadonlyMap<string, SectionOffset>;
  resizes: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>;
  selectedNodeIds: readonly string[];
  selectedSectionIds: readonly string[];
  selectedEdgeIds: readonly string[];
  /** Every projected link, of all three layers. */
  links: readonly {
    edge: { id: string };
    anchors: { source: { x: number; y: number }; target: { x: number; y: number } };
  }[];
}): SelectionExtent {
  const {
    lookup,
    sections,
    offsets,
    resizes,
    selectedNodeIds,
    selectedSectionIds,
    selectedEdgeIds,
    links,
  } = input;

  return useMemo(() => {
    const cardRects = selectedNodeIds.flatMap((id) => {
      const node = lookup.get(id);
      if (!node) return [];
      return [
        {
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width ?? node.width ?? 0,
          height: node.measured?.height ?? node.height ?? 0,
        },
      ];
    });

    const sectionRects = selectedSectionIds.flatMap((id) => {
      const section = sections.find((entry) => entry.id === id);
      if (!section) return [];
      const resized = resizes.get(id);
      if (resized) return [resized];
      const offset = offsets.get(id);
      return [
        {
          x: section.x + (offset?.dx ?? 0),
          y: section.y + (offset?.dy ?? 0),
          width: section.width,
          height: section.height,
        },
      ];
    });

    const selected = new Set(selectedEdgeIds);
    const linkRects = links
      .filter((link) => selected.has(link.edge.id))
      .flatMap((link) => [
        { x: link.anchors.source.x, y: link.anchors.source.y, width: 0, height: 0 },
        { x: link.anchors.target.x, y: link.anchors.target.y, width: 0, height: 0 },
      ]);

    return selectionExtent(
      { cards: cardRects, sections: sectionRects, links: linkRects },
      {
        cards: selectedNodeIds.length,
        sections: selectedSectionIds.length,
        links: selectedEdgeIds.length,
      },
    );
  }, [
    lookup,
    sections,
    offsets,
    resizes,
    selectedNodeIds,
    selectedSectionIds,
    selectedEdgeIds,
    links,
  ]);
}
