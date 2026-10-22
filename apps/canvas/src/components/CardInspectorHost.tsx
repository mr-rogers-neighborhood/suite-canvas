import { mentionContext } from "@suite/graph";
import { useEffect, useMemo, useRef } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers, useCardTitle } from "../hooks/useCardContainers";
import { useCardTitles, useReferenceCounts } from "../hooks/useReferenceCounts";
import { isShareSession } from "../session/session";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { CardInspector } from "./CardInspector";
import { cardLinks, EMPTY_CARD_LINKS, snippetAround } from "./CardPanel";
import { cardWhere } from "./cardWhere";

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
  const inspectorFieldId = useUiStore((state) => state.inspectorFieldId);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const closeInspector = useUiStore((state) => state.closeInspector);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);
  const openInspector = useUiStore((state) => state.openInspector);
  const readOnly = useUiStore((state) => state.readOnly);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageSchema = useUiStore((state) => state.canManageSchema);

  const peers = useBoardPeers(activeBoardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const countOf = useReferenceCounts();
  const card = inspectorNodeId
    ? snapshot.cards.find((entry) => entry.id === inspectorNodeId)
    : undefined;
  // Field ids whose block is in the body, for the Show/Remove toggle.
  const title = useCardTitle(card?.id ?? "");
  const containers = useCardContainers(card?.id ?? "");

  useEffect(() => {
    if (inspectorNodeId && !card) closeInspector();
  }, [inspectorNodeId, card, closeInspector]);

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

  // Cheap: one lookup per type on the card, and the snapshot re-renders this
  // panel whenever a field definition changes.
  const fields = card ? workspace.viewCardFields(card) : [];

  // Pickers and reference rows name other cards, so they read the live title
  // source rather than a snapshot copy.
  const cards = useCardTitles();
  const titles = useMemo(() => new Map(cards.map((entry) => [entry.id, entry.title])), [cards]);

  const links = useMemo(
    () =>
      card
        ? cardLinks({
            cardId: card.id,
            references: snapshot.references,
            cards: snapshot.cards,
            types: snapshot.types,
            edges: snapshot.edges,
            placements: snapshot.placements,
            boards: snapshot.boards,
            displayTitle: (cardId) => titles.get(cardId) ?? workspace.displayTitle(cardId),
            mentionSnippet: (sourceCardId, targetCardId) => {
              const context = mentionContext(workspace.peekContent(sourceCardId), targetCardId);
              // A mention alone on its line has no sentence to quote.
              if (context && (context.before.length > 0 || context.after.length > 0)) {
                const target = titles.get(targetCardId) ?? workspace.displayTitle(targetCardId);
                return [context.before, target, context.after]
                  .filter((part) => part.length > 0)
                  .join(" ");
              }
              // No mention tree (e.g. a title-only mention): fall back to the
              // body text when it names the target, otherwise show no snippet.
              return snippetAround(
                workspace.cardText(sourceCardId),
                titles.get(targetCardId) ?? workspace.displayTitle(targetCardId),
              );
            },
          })
        : EMPTY_CARD_LINKS,
    [
      card,
      workspace,
      titles,
      snapshot.references,
      snapshot.cards,
      snapshot.types,
      snapshot.edges,
      snapshot.placements,
      snapshot.boards,
    ],
  );

  const where = useMemo(
    () => (card ? cardWhere(snapshot, card.id, activeBoardId) : { unplaced: true, entries: [] }),
    [card, snapshot, activeBoardId],
  );

  // Editors need a container to bind to. A content editor opening the panel
  // may create the empty ones; a viewer must never write, so it reads whatever
  // the projection carries and shows static text otherwise.
  const contentId = useMemo(() => {
    if (!card) return null;
    if (containers.contentId) return containers.contentId;
    return canEditContent ? workspace.getContent(card.id).id : workspace.contentId(card.id);
  }, [workspace, card, containers, canEditContent]);
  const titleId = useMemo(() => {
    if (!card) return null;
    if (containers.titleId) return containers.titleId;
    return canEditContent ? workspace.getTitle(card.id).id : workspace.titleId(card.id);
  }, [workspace, card, containers, canEditContent]);

  // Only seeds the tab a card opens on, so one read per card is enough; the
  // panel owns the tab from then on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeded once per card, not per edit.
  const bodyEmpty = useMemo(
    () => (card ? workspace.cardText(card.id).trim().length === 0 : false),
    [card?.id],
  );

  if (!card) return null;

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
      cards={cards}
      links={links}
      focusedField={inspectorFieldId}
      bodyEmpty={bodyEmpty}
      linkCount={countOf(card.id)}
      editing={panelEditing}
      cardDoc={workspace.doc}
      contentId={contentId}
      titleId={titleId}
      cursorStore={cursorStore}
      localUser={localUser}
      peers={peers}
      readOnly={readOnly}
      canEditContent={canEditContent}
      canEditLayout={canEditLayout}
      canManageSchema={canManageSchema}
      restrictLinks={isShareSession()}
      onClose={closeInspector}
      onEdit={() => startEditing(card.id, "body", "panel")}
      onStartEditing={(field) => startEditing(card.id, field, "panel")}
      onEditEnd={stopEditing}
      onSetType={(typeId) => {
        // Type membership is schema, which a board or card share may never change.
        if (canManageSchema) workspace.setCardTypes(card.id, [typeId], typeId);
      }}
      onAddTag={(tagId) => {
        if (canEditContent) workspace.addCardTag(card.id, tagId);
      }}
      onRemoveTag={(tagId) => {
        if (canEditContent) workspace.removeCardTag(card.id, tagId);
      }}
      onCreateTag={(name) => {
        if (!canManageSchema) return;
        const tag = workspace.ensureTag(name);
        workspace.addCardTag(card.id, tag.id);
      }}
      onSetProperty={(fieldId, value) => workspace.setProperty(card.id, fieldId, value)}
      onClearProperty={(fieldId) => workspace.clearProperty(card.id, fieldId)}
      onOpenCardPanel={(cardId) => {
        // A mention or property block may name a card this share leaves out.
        if (snapshot.cards.some((entry) => entry.id === cardId)) openInspector(cardId);
      }}
      onManageTypes={openTypeSettings}
      onFocusCard={(boardId) => focusCard(card.id, boardId)}
      onFocusSection={(sectionId) => {
        if (activeBoardId) focusSection(sectionId, activeBoardId);
      }}
      onRemoveFromBoard={() => {
        if (canEditLayout && activeBoardId) workspace.unplaceCard(activeBoardId, card.id);
      }}
      onFocusLink={(cardId, boardId) => {
        // Links to cards outside the projection render inert; never navigate.
        if (!snapshot.cards.some((entry) => entry.id === cardId)) return;
        // An unplaced card has nothing to reveal, so the panel is the target.
        if (boardId) focusCard(cardId, boardId);
        else openInspector(cardId);
      }}
    />
  );
}
