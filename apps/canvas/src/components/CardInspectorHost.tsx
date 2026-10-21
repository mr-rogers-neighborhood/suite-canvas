import { type Section, sectionForCard, sectionLineage } from "@suite/graph";
import { useEffect, useMemo, useRef } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers, useCardTitle } from "../hooks/useCardContainers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { CardInspector } from "./CardInspector";
import type { CardWhere, CardWhereSection } from "./CardPanel";

/**
 * The chain of sections containing the card's section, outermost first.
 * Membership is derived from geometry, so renaming or moving a section updates
 * every breadcrumb without an extra write.
 */
function sectionPath(match: Section, sections: Section[]): CardWhereSection[] {
  return sections
    .filter((candidate) =>
      sectionLineage(candidate.id, sections).some((entry) => entry.id === match.id),
    )
    .sort((a, b) => a.width * a.height - b.width * b.height || a.id.localeCompare(b.id))
    .map((section) => ({
      id: section.id,
      name: section.title || "Untitled section",
      ...(section.color ? { color: `var(--section-${section.color})` } : {}),
    }));
}

/**
 * Binds the inspector panel to the workspace. Kept out of `CardInspector` so the
 * presentation stays testable with plain props.
 */
export function CardInspectorHost() {
  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const closeInspector = useUiStore((state) => state.closeInspector);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);

  const peers = useBoardPeers(activeBoardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const card = inspectorNodeId
    ? snapshot.cards.find((entry) => entry.id === inspectorNodeId)
    : undefined;
  const title = useCardTitle(card?.id ?? "");
  const containers = useCardContainers(card?.id ?? "");

  useEffect(() => {
    if (inspectorNodeId && !card) closeInspector();
  }, [inspectorNodeId, card, closeInspector]);

  // Closing or switching the panel releases this card's panel editing session;
  // a panel edit in another surface (a library row) is left alone.
  const previousInspectorId = useRef(inspectorNodeId);
  useEffect(() => {
    const previous = previousInspectorId.current;
    previousInspectorId.current = inspectorNodeId;
    if (previous === inspectorNodeId) return;
    const state = useUiStore.getState();
    if (state.editingSurface === "panel" && state.editingNodeId === previous) state.stopEditing();
  }, [inspectorNodeId]);

  // Cheap: one lookup per type on the card, and the snapshot re-renders this
  // panel whenever a field definition changes.
  const fields = card ? workspace.viewCardFields(card) : [];

  const where = useMemo<CardWhere>(() => {
    if (!card) return { unplaced: true, entries: [] };
    const placements = snapshot.placements.filter((entry) => entry.cardId === card.id);
    if (placements.length === 0) return { unplaced: true, entries: [] };

    const boardsById = new Map(snapshot.boards.map((board) => [board.id, board]));
    const ordered = [...placements].sort(
      (a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId),
    );
    const homeId = ordered[0]?.boardId ?? null;
    const entries = ordered
      .flatMap((placement) => {
        const board = boardsById.get(placement.boardId);
        if (!board) return [];
        const sections = snapshot.sections.filter((entry) => entry.boardId === board.id);
        const match = sectionForCard(placement, sections);
        return [
          {
            boardId: board.id,
            boardName: board.name,
            isCurrent: board.id === activeBoardId,
            isHome: board.id === homeId,
            sectionPath: match ? sectionPath(match, sections) : [],
          },
        ];
      })
      .sort(
        (a, b) => Number(b.isHome) - Number(a.isHome) || a.boardName.localeCompare(b.boardName),
      );

    return { unplaced: false, entries };
  }, [card, snapshot.placements, snapshot.sections, snapshot.boards, activeBoardId]);

  // Editors need a container to bind to; opening the panel is an editing
  // surface, so it may create the empty ones the same way the card does.
  const contentId = useMemo(
    () => (card ? (containers.contentId ?? workspace.getContent(card.id).id) : null),
    [workspace, card, containers],
  );
  const titleId = useMemo(
    () => (card ? (containers.titleId ?? workspace.getTitle(card.id).id) : null),
    [workspace, card, containers],
  );

  if (!card || contentId === null || titleId === null) return null;

  const panelEditing =
    editingNodeId === card.id && editingSurface === "panel" ? editingField : null;

  return (
    <CardInspector
      card={card}
      title={title}
      types={snapshot.types}
      tags={snapshot.tags}
      fields={fields}
      where={where}
      editing={panelEditing}
      cardDoc={workspace.doc}
      contentId={contentId}
      titleId={titleId}
      cursorStore={cursorStore}
      localUser={localUser}
      peers={peers}
      onClose={() => {
        if (editingNodeId === card.id && editingSurface === "panel") stopEditing();
        closeInspector();
      }}
      onEdit={() => startEditing(card.id, "body", "panel")}
      onStartEditing={(field) => startEditing(card.id, field, "panel")}
      onEditEnd={stopEditing}
      onSetType={(typeId) => workspace.setCardTypes(card.id, [typeId], typeId)}
      onAddTag={(tagId) => workspace.addCardTag(card.id, tagId)}
      onRemoveTag={(tagId) => workspace.removeCardTag(card.id, tagId)}
      onCreateTag={(name) => {
        const tag = workspace.ensureTag(name);
        workspace.addCardTag(card.id, tag.id);
      }}
      onSetProperty={(fieldId, value) => workspace.setProperty(card.id, fieldId, value)}
      onClearProperty={(fieldId) => workspace.clearProperty(card.id, fieldId)}
      onManageTypes={openTypeSettings}
      onFocusCard={(boardId) => focusCard(card.id, boardId)}
      onFocusSection={(sectionId) => {
        if (activeBoardId) focusSection(sectionId, activeBoardId);
      }}
      onRemoveFromBoard={() => {
        if (activeBoardId) workspace.unplaceCard(activeBoardId, card.id);
      }}
    />
  );
}
