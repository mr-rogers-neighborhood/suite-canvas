import type { Rect } from "@suite/graph";
import { sectionMovePlan, unionRect } from "@suite/graph";
import { useCallback, useMemo, useRef, useState } from "react";
import { useUiStore } from "../../store/useUiStore";
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
      if (peer.sectionDrag) gestures.push(peer.sectionDrag);
    }
    return gestures;
  }, [localSectionDrag, peers]);

  const sectionOffsetsMap = useMemo(
    () => sectionOffsets(boardSections, sectionGestures),
    [boardSections, sectionGestures],
  );

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

  const cardOffsetsMap = useMemo(
    () => cardSectionOffsets(sectionMembershipMap, sectionOffsetsMap),
    [sectionMembershipMap, sectionOffsetsMap],
  );

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
    (sectionId: string | null) => {
      if (sectionId) store.getState().unselectNodesAndEdges();
      selectSection(sectionId);
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
      if (root) {
        const dx = position.x - root.x;
        const dy = position.y - root.y;
        if (dx !== 0 || dy !== 0) {
          const plan = sectionMovePlan(sectionId, boardSections, boardPlacementList);
          workspace.moveSectionsBatch({
            sections: plan.sections.map((section) => ({
              id: section.id,
              x: section.x + dx,
              y: section.y + dy,
            })),
            placements: plan.placements.map((placement) => ({
              boardId: placement.boardId,
              cardId: placement.cardId,
              x: placement.x + dx,
              y: placement.y + dy,
            })),
          });
        }
      }
      setLocalSectionDrag(null);
      setSectionDragPresence(null);
    },
    [boardSections, boardPlacementList, workspace, setSectionDragPresence, canEditLayout],
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
      workspace.updateSectionGeometry(sectionId, rect);
      setLocalSectionResize(null);
      setSectionResizePresence(null);
    },
    [workspace, setSectionResizePresence, canEditLayout],
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
  };
}
