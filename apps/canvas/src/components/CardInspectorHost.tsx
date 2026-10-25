import { useEffect, useRef } from "react";
import { isShareSession } from "../session/session";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { CardInspector } from "./CardInspector";
import { ContainerPanel } from "./ContainerPanel";
import { useCardPanelModel } from "./useCardPanelModel";
import { useContainerPanelModel } from "./useContainerPanelModel";

/**
 * Binds the inspector drawer to the workspace. The model comes from
 * `useCardPanelModel`, which the full-canvas focus surface also uses, so both
 * surfaces render one editor binding of the same card.
 */
export function CardInspectorHost() {
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const inspectorFieldId = useUiStore((state) => state.inspectorFieldId);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const closeInspector = useUiStore((state) => state.closeInspector);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const readOnly = useUiStore((state) => state.readOnly);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageSchema = useUiStore((state) => state.canManageSchema);

  const model = useCardPanelModel(inspectorNodeId, "panel");
  const container = useContainerPanelModel();
  const workspace = useCanvasStore((state) => state.workspace);
  const closeContainerInspector = useUiStore((state) => state.closeContainerInspector);
  const requestPortalOpen = useUiStore((state) => state.requestPortalOpen);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);

  const containerTarget = useUiStore((state) => state.containerInspector);
  // A container that vanished (deleted in another tab, trashed) closes the drawer
  // rather than leaving a panel describing something that is not there.
  const containerMissing = containerTarget !== null && container === null;
  useEffect(() => {
    if (containerMissing) closeContainerInspector();
  }, [containerMissing, closeContainerInspector]);

  useEffect(() => {
    if (inspectorNodeId && !model) closeInspector();
  }, [inspectorNodeId, model, closeInspector]);

  // Closing or switching the panel releases this card's panel editing session.
  const previousInspectorId = useRef(inspectorNodeId);
  useEffect(() => {
    const previous = previousInspectorId.current;
    previousInspectorId.current = inspectorNodeId;
    if (previous === inspectorNodeId) return;
    const state = useUiStore.getState();
    if (state.editingSurface === "panel" && state.editingNodeId === previous) {
      state.stopEditing();
    }
  }, [inspectorNodeId]);

  // Containers first: they share the drawer, and only one of the two can be open.
  if (container) {
    return (
      <ContainerPanel
        model={container}
        onClose={closeContainerInspector}
        onOpenBoard={(cardId, boardId) => requestPortalOpen(cardId, boardId)}
        onLocate={() => {
          if (container.kind === "portal") {
            if (container.boardId) focusCard(container.id, container.boardId);
            return;
          }
          if (container.section) focusSection(container.section.id, container.section.boardId);
        }}
        onSetColor={(color) => {
          if (container.kind === "portal") {
            if (container.board) workspace.setBoardColor(container.board.id, color);
            return;
          }
          workspace.setSectionColor(container.id, color);
        }}
        onRename={(title) => {
          if (container.kind === "section") workspace.renameSection(container.id, title);
        }}
      />
    );
  }

  if (!model) return null;

  const panelEditing =
    editingNodeId === model.card.id && editingSurface === "panel" ? editingField : null;

  return (
    <CardInspector
      card={model.card}
      title={model.title}
      types={model.types}
      tags={model.tags}
      boards={model.boards}
      fields={model.fields}
      where={model.where}
      cards={model.cards}
      links={model.links}
      focusedField={inspectorFieldId}
      bodyEmpty={model.bodyEmpty}
      linkCount={model.linkCount}
      editing={panelEditing}
      cardDoc={model.cardDoc}
      contentId={model.contentId}
      titleId={model.titleId}
      cursorStore={model.cursorStore}
      localUser={model.localUser}
      peers={model.peers}
      readOnly={readOnly}
      canEditContent={canEditContent}
      canEditLayout={canEditLayout}
      canManageSchema={canManageSchema}
      restrictLinks={isShareSession()}
      onClose={closeInspector}
      // Edit opens the full-canvas surface; the inspector keeps reading the same
      // card behind it, so closing either one leaves the other consistent.
      onEdit={() => openCardFocus(model.card.id)}
      onStartEditing={model.onStartEditing}
      onEditEnd={model.onEditEnd}
      onSetType={model.onSetType}
      onAddTag={model.onAddTag}
      onRemoveTag={model.onRemoveTag}
      onCreateTag={model.onCreateTag}
      onSetProperty={model.onSetProperty}
      onClearProperty={model.onClearProperty}
      onOpenCardPanel={model.onOpenCardPanel}
      onManageTypes={model.onManageTypes}
      onFocusCard={model.onFocusCard}
      onFocusSection={model.onFocusSection}
      onRemoveFromBoard={model.onRemoveFromBoard}
      onFocusLink={model.onFocusLink}
    />
  );
}
