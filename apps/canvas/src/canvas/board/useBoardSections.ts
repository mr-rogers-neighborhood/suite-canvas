import type { Rect } from "@suite/graph";
import { planSectionFit, sectionLineage, sectionMovePlan, unionRect } from "@suite/graph";
import { useCallback, useMemo, useRef, useState } from "react";
import type { InteractionMode } from "../../store/interactionMode";
import { useUiStore } from "../../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../interactions/multiSelect";
import { cardSectionOffsets, sectionOffsets } from "../sections/sectionLayout";
import { DRAG_THROTTLE_MS } from "./boardSupport";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

/** Default box for a section created without a selection to wrap. */
export const NEW_SECTION_SIZE = { width: 360, height: 260 } as const;

/**
 * Sections on this board: their live drag/resize offsets, the presence those
 * gestures publish, and the writes a finished gesture commits. A section is not
 * a React Flow node, so its gesture state is board-local.
 */
/**
 * What a press on a section means under the menu bar's mode.
 *
 * A section is selected by pressing its frame, and selecting one opens its panel — the same
 * gesture that opens a card's. So it answers the mode the same way: `locked` is a picture to
 * move and a press does nothing, `quiet` selects without the panel, `inspect` is both.
 */
export function sectionPressUnder(
  mode: InteractionMode,
  sectionId: string | null,
): "clear" | "ignore" | "select" | "select-quietly" {
  if (sectionId === null) return "clear";
  if (mode === "locked") return "ignore";
  return mode === "inspect" ? "select" : "select-quietly";
}

export function useBoardSections(
  ui: ReturnType<typeof useBoardUi>,
  input: { projection: ReturnType<typeof useBoardProjection> },
) {
  const {
    workspace,
    activeBoardId,
    peers,
    canEditLayout,
    canCreateContent,
    selectSection,
    setEditingSection,
    setSectionDragPresence,
    setSectionResizePresence,
    store,
  } = ui;
  const { projection } = input;
  const { boardSections, boardPlacementList, sectionMembershipMap } = projection;
  const { lens } = ui;

  const [localSectionDrag, setLocalSectionDrag] = useState<{
    sectionId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [localSectionResize, setLocalSectionResize] = useState<{
    sectionId: string;
    rect: Rect;
  } | null>(null);
  // A section is not a node, so its connector selection is board-local state
  // rather than the store's `selectedConnector` (which names a node id).
  const [selectedSectionConnector, setSelectedSectionConnector] = useState<{
    sectionId: string;
    connectorId: string;
  } | null>(null);

  // Connector dots appear while a link is being dragged: the drop targets have
  // to be visible mid-gesture. W2 will fold this into the link tool's state.
  const lastSectionPublish = useRef(0);

  const sectionGestures = useMemo(() => {
    const gestures: { sectionId: string; position: { x: number; y: number } }[] = [];
    if (localSectionDrag) gestures.push(localSectionDrag);
    for (const peer of Object.values(peers)) {
      const drag = peer.sectionDrag;
      if (!drag) continue;
      gestures.push({ sectionId: drag.sectionId, position: drag.position });
      // A group drag names every frame it carries, and they all moved by one translation: the primary's
      // position is the delta, so each other frame's gesture is its own stored corner plus that.
      if (!drag.sectionIds || drag.sectionIds.length < 2) continue;
      const primary = boardSections.find((section) => section.id === drag.sectionId);
      if (!primary) continue;
      const dx = drag.position.x - primary.x;
      const dy = drag.position.y - primary.y;
      for (const id of drag.sectionIds) {
        if (id === drag.sectionId) continue;
        const section = boardSections.find((entry) => entry.id === id);
        if (!section) continue;
        gestures.push({ sectionId: id, position: { x: section.x + dx, y: section.y + dy } });
      }
    }
    return gestures;
  }, [boardSections, localSectionDrag, peers]);

  // A card drag carrying a selected frame: the frame and every frame inside it paint at the pointer.
  // Read from the store rather than passed down, because the drag is React Flow's and this hook runs
  // above the surface that sees it.
  const dragFollow = useUiStore((state) => state.dragFollow);
  const sectionOffsetsMap = useMemo(() => {
    const offsets = sectionOffsets(boardSections, sectionGestures);
    if (dragFollow === null) return offsets;
    for (const rootId of dragFollow.sectionIds) {
      if (!boardSections.some((section) => section.id === rootId)) continue;
      for (const section of sectionLineage(rootId, boardSections)) {
        offsets.set(section.id, { dx: dragFollow.dx, dy: dragFollow.dy });
      }
    }
    return offsets;
  }, [boardSections, sectionGestures, dragFollow]);

  const sectionResizes = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const peer of Object.values(peers)) {
      const resizing = peer.sectionResize;
      if (!resizing) continue;
      map.set(resizing.sectionId, {
        x: resizing.position.x,
        y: resizing.position.y,
        width: resizing.width,
        height: resizing.height,
      });
    }
    if (localSectionResize) map.set(localSectionResize.sectionId, localSectionResize.rect);
    return map;
  }, [peers, localSectionResize]);

  const cardOffsetsMap = useMemo(() => {
    const offsets = cardSectionOffsets(sectionMembershipMap, sectionOffsetsMap);
    // A card React Flow is already dragging is at the pointer by its own means; shifting it by the
    // frame's offset as well would move it twice as far as the rest of the group.
    for (const id of dragFollow?.carrying ?? []) offsets.delete(id);
    return offsets;
  }, [sectionMembershipMap, sectionOffsetsMap, dragFollow]);

  /**
   * A section is off the lens when none of its member cards is on it. Sections
   * stay visible: they are the spatial context a dimmed card sits in.
   */
  const dimmedSectionIds = useMemo(() => {
    if (lens.view === null) return undefined;
    const sectionsWithMatches = new Set<string>();
    for (const [cardId, sectionId] of sectionMembershipMap) {
      if (lens.cardIds.has(cardId)) sectionsWithMatches.add(sectionId);
    }
    const dimmed = new Set<string>();
    for (const sectionId of sectionMembershipMap.values()) {
      if (!sectionsWithMatches.has(sectionId)) dimmed.add(sectionId);
    }
    return dimmed;
  }, [lens, sectionMembershipMap]);

  const handleSelectSection = useCallback(
    (sectionId: string | null, additive = false) => {
      const outcome = sectionPressUnder(useUiStore.getState().interactionMode, sectionId);
      if (outcome === "ignore") return;
      // A modifier is membership: a frame joins or leaves the set and nothing else happens, so a
      // drag does not start and the panel does not move between frames while the reader builds one.
      if (additive) {
        if (sectionId !== null) useUiStore.getState().toggleSection(sectionId);
        return;
      }
      if (outcome === "clear") {
        selectSection(null);
        return;
      }
      store.getState().unselectNodesAndEdges();
      selectSection(sectionId);
      // Quiet mode still selects, because a selected frame is what the next edit acts on; whether the
      // drawer opens is `interactionMode`'s answer, and the host reads it like it does for a link.
    },
    [selectSection, store],
  );

  const publishSectionDrag = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      const now = performance.now();
      if (now - lastSectionPublish.current < DRAG_THROTTLE_MS) return;
      lastSectionPublish.current = now;
      setSectionDragPresence({ sectionId, position });
    },
    [setSectionDragPresence],
  );

  /**
   * Card sizes as React Flow has measured them, for the fit plan.
   *
   * The stored placement wins because it is the document's record; a card React Flow has not
   * measured yet falls back to the type default, so it contributes a box rather than a zero and
   * a section does not collapse around it mid-measure.
   */
  const cardSizesOnBoard = useCallback(() => {
    const sizes = new Map<string, { width: number; height: number }>();
    const lookup = store.getState().nodeLookup;
    for (const placement of boardPlacementList) {
      if (placement.boardId !== activeBoardId) continue;
      const node = lookup.get(placement.cardId);
      sizes.set(placement.cardId, {
        width: placement.width ?? node?.measured?.width ?? node?.width ?? DEFAULT_CARD_WIDTH,
        height: placement.height ?? node?.measured?.height ?? node?.height ?? DEFAULT_CARD_HEIGHT,
      });
    }
    return sizes;
  }, [activeBoardId, boardPlacementList, store]);

  const handleSectionDrag = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      setLocalSectionDrag({ sectionId, position });
      publishSectionDrag(sectionId, position);
    },
    [publishSectionDrag],
  );

  const handleSectionDragEnd = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      if (!canEditLayout) return;
      const root = boardSections.find((section) => section.id === sectionId);
      if (root && activeBoardId) {
        const dx = position.x - root.x;
        const dy = position.y - root.y;
        if (dx !== 0 || dy !== 0) {
          const plan = sectionMovePlan(sectionId, boardSections, boardPlacementList);
          const movedSections = plan.sections.map((section) => ({
            id: section.id,
            x: section.x + dx,
            y: section.y + dy,
          }));
          const movedPlacements = plan.placements.map((placement) => ({
            boardId: placement.boardId,
            cardId: placement.cardId,
            x: placement.x + dx,
            y: placement.y + dy,
          }));
          workspace.moveSectionsBatch({
            sections: movedSections,
            placements: movedPlacements,
          });
          // Dragging a section out of the frame that held it is also a change to that frame: it
          // counted the child as a member and has to stop. The moved geometry is passed in
          // because the document has not observed the batch above yet.
          const sectionOverrides = new Map<string, Rect>();
          for (const moved of movedSections) {
            const before = boardSections.find((entry) => entry.id === moved.id);
            if (!before) continue;
            sectionOverrides.set(moved.id, {
              x: moved.x,
              y: moved.y,
              width: before.width,
              height: before.height,
            });
          }
          const fit = planSectionFit({
            boardId: activeBoardId,
            sections: boardSections,
            placements: boardPlacementList,
            cardSizes: cardSizesOnBoard(),
            sectionOverrides,
            // The batch above already landed these rects; the plan only has to fit around them.
            overridesAreWritten: true,
            placementOverrides: new Map(
              movedPlacements.map((placement) => [
                placement.cardId,
                { x: placement.x, y: placement.y },
              ]),
            ),
          });
          if (fit) workspace.applyLayoutPlan(fit);
        }
      }
      setLocalSectionDrag(null);
      setSectionDragPresence(null);
    },
    [
      boardSections,
      boardPlacementList,
      workspace,
      setSectionDragPresence,
      canEditLayout,
      activeBoardId,
      cardSizesOnBoard,
    ],
  );

  const handleSectionResize = useCallback(
    (sectionId: string, rect: Rect) => {
      setLocalSectionResize({ sectionId, rect });
      const now = performance.now();
      if (now - lastSectionPublish.current < DRAG_THROTTLE_MS) return;
      lastSectionPublish.current = now;
      setSectionResizePresence({
        sectionId,
        position: { x: rect.x, y: rect.y },
        width: rect.width,
        height: rect.height,
      });
    },
    [setSectionResizePresence],
  );

  const handleSectionResizeEnd = useCallback(
    (sectionId: string, rect: Rect) => {
      if (!canEditLayout) return;
      // The frames this one sits in grow around it: a child section is a member of its parent, so
      // resizing it is the same act as resizing a card and the parent's elastic rule applies. Both
      // writes go through one plan, which is one undo step, and the resized rect travels as an
      // override so the plan keeps the size the reader chose instead of fitting it back to tight.
      const plan = planSectionFit({
        boardId: activeBoardId ?? "",
        sections: boardSections,
        placements: boardPlacementList,
        cardSizes: cardSizesOnBoard(),
        sectionOverrides: new Map([[sectionId, rect]]),
      });
      if (plan) workspace.applyLayoutPlan(plan);
      else workspace.updateSectionGeometry(sectionId, rect);
      setLocalSectionResize(null);
      setSectionResizePresence(null);
    },
    [
      workspace,
      setSectionResizePresence,
      canEditLayout,
      activeBoardId,
      boardSections,
      boardPlacementList,
      cardSizesOnBoard,
    ],
  );

  const handleSectionRename = useCallback(
    (sectionId: string, title: string) => {
      if (!canEditLayout) {
        setEditingSection(null);
        return;
      }
      workspace.renameSection(sectionId, title.trim());
      setEditingSection(null);
    },
    [workspace, setEditingSection, canEditLayout],
  );

  const createSectionAt = useCallback(
    (position: { x: number; y: number }, wrapSelection = false) => {
      if (!canCreateContent || !activeBoardId) return;
      const selected = useUiStore.getState().selectedNodeIds;
      let rect: Rect = { x: position.x, y: position.y, ...NEW_SECTION_SIZE };

      if (wrapSelection && selected.length > 0) {
        const lookup = store.getState().nodeLookup;
        const cardRects = selected.flatMap((id) => {
          const node = lookup.get(id);
          if (!node) return [];
          const width = node.measured?.width ?? node.width ?? 224;
          const height = node.measured?.height ?? node.height ?? 160;
          return [{ x: node.position.x, y: node.position.y, width, height }];
        });
        const first = cardRects[0];
        if (first) {
          const union = unionRect(first, cardRects.slice(1), 24);
          rect = {
            x: union.x,
            y: union.y - 16,
            width: union.width,
            height: union.height + 16,
          };
        }
      }

      const section = workspace.createSection({ boardId: activeBoardId, ...rect });
      store.getState().unselectNodesAndEdges();
      selectSection(section.id);
      setEditingSection(section.id);
    },
    [activeBoardId, store, workspace, selectSection, setEditingSection, canCreateContent],
  );

  /**
   * Fits a section to what is inside it: its cards, and any section nested in it.
   *
   * The plan is the same one a gesture uses, so a nested frame counts as a member here too. An
   * empty section is the one case a toggle should collapse rather than leave alone, which is why
   * it is named: a refit that follows a drag must never move a section the reader emptied on
   * purpose.
   */
  const shrinkSectionToFit = useCallback(
    (sectionId: string) => {
      if (!canEditLayout || !activeBoardId) return;
      const plan = planSectionFit({
        boardId: activeBoardId,
        sections: boardSections,
        placements: boardPlacementList,
        cardSizes: cardSizesOnBoard(),
        collapseEmpty: new Set([sectionId]),
      });
      if (plan) workspace.applyLayoutPlan(plan);
    },
    [activeBoardId, boardSections, boardPlacementList, canEditLayout, cardSizesOnBoard, workspace],
  );

  const toggleSectionShrinkToFit = useCallback(
    (sectionId: string) => {
      if (!canEditLayout) return;
      const section = boardSections.find((s) => s.id === sectionId);
      if (!section) return;

      const next = section.shrinkToFit === false;
      workspace.setSectionShrinkToFit(sectionId, next);
      if (next) {
        shrinkSectionToFit(sectionId);
      }
    },
    [boardSections, canEditLayout, workspace, shrinkSectionToFit],
  );

  return {
    localSectionDrag,
    localSectionResize,
    selectedSectionConnector,
    setSelectedSectionConnector,
    sectionGestures,
    sectionOffsetsMap,
    sectionResizes,
    cardOffsetsMap,
    dimmedSectionIds,
    handleSelectSection,
    handleSectionDrag,
    handleSectionDragEnd,
    handleSectionResize,
    handleSectionResizeEnd,
    handleSectionRename,
    createSectionAt,
    shrinkSectionToFit,
    toggleSectionShrinkToFit,
  };
}
