import { useEffect, useRef } from "react";
import { useNavigateTarget } from "../canvas/navigateTarget";
import { isShareSession } from "../session/session";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { CardInspector } from "./CardInspector";
import { ContainerPanel } from "./ContainerPanel";
import { LinkInspector } from "./LinkInspector";
import { useCardPanelModel } from "./useCardPanelModel";
import { useContainerPanelModel } from "./useContainerPanelModel";
import { useLinkInspectorModel } from "./useLinkInspectorModel";

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
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const closeContainerInspector = useUiStore((state) => state.closeContainerInspector);
  const requestPortalOpen = useUiStore((state) => state.requestPortalOpen);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);

  const containerTarget = useUiStore((state) => state.containerInspector);
  const link = useLinkInspectorModel();
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const linkEndMove = useUiStore((state) => state.linkEndMove);
  const startLinkEndMove = useUiStore((state) => state.startLinkEndMove);
  const cancelLinkEndMove = useUiStore((state) => state.cancelLinkEndMove);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const navigateTo = useNavigateTarget();
  const linking = useUiStore((state) => state.linkingInProgress);

  /**
   * Escape closes the panel before anything under it reacts, and leaves the card
   * selected — its own × does the same, so the key and the button agree.
   *
   * While *any* card is being edited the panel steps out of the layer stack: an
   * editor owns Escape, and it is the innermost thing on screen whichever surface
   * it is on. That is the canvas card body as much as a field in the panel, which
   * is why the test is `editingNodeId` and not "editing inside the panel".
   */
  useEscapeLayer(closeInspector, inspectorNodeId !== null && editingNodeId === null);
  // A container that vanished (deleted in another tab, trashed) closes the drawer
  // rather than leaving a panel describing something that is not there.
  /**
   * The drawer is one surface in three shapes, and a drawn link crosses it: the
   * preview runs under the panel and the destination is usually what the panel
   * covers. The fade is paint only — no pointer-events change, so a release over
   * the panel still lands on the panel and the press-on-canvas dismissal rule is
   * untouched. It rides a root attribute because the three panels do not share a
   * wrapper: they are early returns, and `display: contents` frames cost more than
   * the rule they would enable.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (!linking) {
      root.removeAttribute("data-inspector-linking");
      return;
    }
    root.setAttribute("data-inspector-linking", "true");
    return () => root.removeAttribute("data-inspector-linking");
  }, [linking]);

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

  // One link, one panel. A link is selected by the edge selection it already has,
  // so the drawer needs no second open flag for it.
  if (link && selectedEdgeIds.length === 1) {
    const edgeId = link.edge.id;
    return (
      <LinkInspector
        model={link}
        onClose={() => setSelectedEdgeIds([])}
        onNavigateEnd={(end) => {
          navigateTo({ kind: end.kind, id: end.id });
        }}
        onMoveEnd={(end) => startLinkEndMove({ edgeId, end })}
        movingEnd={linkEndMove?.edgeId === edgeId ? linkEndMove.end : null}
        onCancelMoveEnd={cancelLinkEndMove}
        onSetPath={(path) => workspace.setEdgePath(edgeId, path)}
        onSetBidirectional={(bidirectional) =>
          workspace.setEdgeBidirectional(edgeId, bidirectional)
        }
        onReverse={() => workspace.reverseEdge(edgeId)}
        onDelete={() => {
          workspace.removeEdge(edgeId);
          setSelectedEdgeIds([]);
        }}
        onSetDescription={(description) =>
          workspace.setEdgeLabel(edgeId, description.trim() ? description : null)
        }
        onSetLabelOffset={(offset) => workspace.setEdgeLabelOffset(edgeId, offset)}
      />
    );
  }

  // Containers next: they share the drawer, and only one of the three can be open.
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
        onSetCover={(attachmentId) => {
          if (container.kind === "portal" && container.board) {
            workspace.setBoardCover(container.board.id, attachmentId);
          }
        }}
        onRename={(title) => {
          if (container.kind === "section") workspace.renameSection(container.id, title);
        }}
        onNavigate={(target) => {
          navigateTo(target);
        }}
        // An orphaned portal is a dead end unless the panel can point it
        // somewhere: a new board, or off this one.
        onRetarget={(boardId) => {
          if (!canEditLayout) return;
          workspace.setPortalTarget(container.id, boardId);
        }}
        onRemove={() => {
          if (!canEditLayout || !activeBoardId) return;
          workspace.unplaceCard(activeBoardId, container.id);
          // Nothing is drawn where the panel was pointing, so the drawer goes too.
          closeContainerInspector();
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
      onAddType={model.onAddType}
      onRemoveType={model.onRemoveType}
      onAddTag={model.onAddTag}
      onRemoveTag={model.onRemoveTag}
      onCreateTag={model.onCreateTag}
      onSetProperty={model.onSetProperty}
      onClearProperty={model.onClearProperty}
      onOpenCardPanel={model.onOpenCardPanel}
      onManageTypes={model.onManageTypes}
      onFocusCard={model.onFocusCard}
      onFocusSection={model.onFocusSection}
      onPlace={model.onPlace}
      onRemoveFromBoard={model.onRemoveFromBoard}
      onFocusLink={model.onFocusLink}
    />
  );
}
