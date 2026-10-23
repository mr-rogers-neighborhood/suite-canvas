import { useEffect, useRef } from "react";
import { useTypeTable } from "../ice/useTypeTable";
import { isShareSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { CardInspector } from "./CardInspector";
import { TypeTable } from "./TypeTable";
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
  const graphBandActive = useUiStore((state) => state.graphBandActive);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const requestGraphFrameType = useUiStore((state) => state.requestGraphFrameType);

  const model = useCardPanelModel(inspectorNodeId, "panel");
  // At the ceiling the subject is a type, not a placement, so the panel becomes
  // the Types table — the same scoped library the graph band shows, in the place
  // the user already reads things. It reads the snapshot and writes nothing.
  const typeRows = useTypeTable(graphBandActive ? activeBoardId : null);

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

  if (graphBandActive) {
    return (
      <aside
        aria-label="Types in view"
        data-testid="inspector-types"
        className="card-inspector flex h-full w-full flex-col overflow-hidden"
      >
        <header className="card-inspector__header flex shrink-0 items-center justify-between px-4 py-3">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-[var(--ink)]">Types in view</h2>
            <p className="m-0 text-[11px] text-[var(--ink-muted)]">
              Graph view. Pick a type to scope the library.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="inspector-types-close"
            className="rounded px-1 text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onClick={closeInspector}
          >
            {"\u00d7"}
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <TypeTable
            rows={typeRows}
            boardId={activeBoardId}
            onFrameType={(typeId) => requestGraphFrameType(typeId)}
            readOnly={readOnly}
            canEditContent={canEditContent}
            canEditLayout={canEditLayout}
          />
        </div>
      </aside>
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
