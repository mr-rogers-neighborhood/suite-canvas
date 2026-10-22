import { mentionContext } from "@suite/graph";
import { useMemo } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers, useCardTitle } from "../hooks/useCardContainers";
import { useCardTitles } from "../hooks/useReferenceCounts";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import {
  CardPanel,
  cardLinks,
  EMPTY_CARD_LINKS,
  snippetAround,
  useBodyPropertyBlocks,
} from "./CardPanel";
import { cardWhere } from "./cardWhere";

export interface LibraryCardPanelProps {
  cardId: string;
}

/**
 * Binds the shared card surface to one expanded library row. Mirrors
 * `CardInspectorHost`: every write goes through the same workspace calls, and
 * the panel only owns the editor while the library is the panel owner.
 */
export function LibraryCardPanel({ cardId }: LibraryCardPanelProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const panelOwner = useUiStore((state) => state.panelOwner);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const setPanelOwner = useUiStore((state) => state.setPanelOwner);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);
  const openInspector = useUiStore((state) => state.openInspector);

  const peers = useBoardPeers(activeBoardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const card = snapshot.cards.find((entry) => entry.id === cardId);
  const bodyFields = useBodyPropertyBlocks(cardId);
  const title = useCardTitle(cardId);
  const containers = useCardContainers(cardId);

  // Same shape the inspector builds: options and rows read the live titles.
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
    () => cardWhere(snapshot, cardId, activeBoardId),
    [snapshot, cardId, activeBoardId],
  );

  const contentId = useMemo(
    () => (card ? (containers.contentId ?? workspace.getContent(card.id).id) : null),
    [workspace, card, containers],
  );
  const titleId = useMemo(
    () => (card ? (containers.titleId ?? workspace.getTitle(card.id).id) : null),
    [workspace, card, containers],
  );

  if (!card || contentId === null || titleId === null) return null;

  const fields = workspace.viewCardFields(card);
  const editing =
    editingNodeId === card.id && editingSurface === "panel" && panelOwner === "library"
      ? editingField
      : null;

  const beginEditing = (field: "title" | "body") => {
    // Claiming the panel first means a session left open in the inspector is
    // released before this editor becomes the author.
    setPanelOwner("library");
    startEditing(card.id, field, "panel");
  };

  return (
    <CardPanel
      card={card}
      title={title}
      types={snapshot.types}
      tags={snapshot.tags}
      fields={fields}
      where={where}
      cards={cards}
      links={links}
      variant="embedded"
      editing={editing}
      cardDoc={workspace.doc}
      contentId={contentId}
      titleId={titleId}
      cursorStore={cursorStore}
      localUser={localUser}
      peers={peers}
      onStartEditing={beginEditing}
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
      bodyFields={bodyFields}
      onShowInBody={(fieldId) => workspace.appendPropertyBlock(card.id, fieldId)}
      onHideFromBody={(fieldId) => workspace.removePropertyBlock(card.id, fieldId)}
      onOpenCardPanel={openInspector}
      onManageTypes={openTypeSettings}
      onFocusCard={(boardId) => focusCard(card.id, boardId)}
      onFocusSection={(sectionId) => {
        if (activeBoardId) focusSection(sectionId, activeBoardId);
      }}
      onRemoveFromBoard={() => {
        if (activeBoardId) workspace.unplaceCard(activeBoardId, card.id);
      }}
      onFocusLink={(cardId, boardId) => {
        if (boardId) focusCard(cardId, boardId);
        else openInspector(cardId);
      }}
    />
  );
}
