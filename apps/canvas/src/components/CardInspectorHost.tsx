import { useEffect, useRef } from "react";
import { isShareSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { CardInspector } from "./CardInspector";
import { useCardPanelModel } from "./useCardPanelModel";

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
