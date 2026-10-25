import type { Board, Card, CardFieldView, CardType, PropertyValue, Tag } from "@suite/graph";
import { mentionContext } from "@suite/graph";
import { useReactFlow } from "@xyflow/react";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { useMemo } from "react";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers, useCardTitle } from "../hooks/useCardContainers";
import { useCardTitles, useReferenceCounts } from "../hooks/useReferenceCounts";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import type { CardLinks, CardPanelEditingField, CardWhere } from "./CardPanel";
import { cardLinks, EMPTY_CARD_LINKS, snippetAround } from "./CardPanel";
import type { CardPickerOption } from "./CardPicker";
import { cardWhere } from "./cardWhere";

/** Which surface owns the card's editors while this binding is mounted. */
export type CardSurface = "panel" | "focus";

/**
 * Everything one card's panel needs, read and bound once. The inspector and the
 * full-canvas focus surface render the same `CardPanel` from this model, so
 * there is one editor binding and one set of write paths — never a second copy
 * of the card's state.
 */
export interface CardPanelModel {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  boards: readonly Board[];
  fields: CardFieldView[];
  where: CardWhere;
  cards: readonly CardPickerOption[];
  links: CardLinks;
  contentId: ContainerID | null;
  titleId: ContainerID | null;
  cursorStore: CursorEphemeralStore | null;
  localUser: PresenceUser | null;
  peers: PeerPresence[];
  bodyEmpty: boolean;
  linkCount: number;
  cardDoc: LoroDoc;
  onStartEditing: (field: CardPanelEditingField) => void;
  onEditEnd: () => void;
  /** Makes `typeId` the primary type; the other members stay (ADR-0053 §1). */
  onSetType: (typeId: string) => void;
  /** Adds a type that only contributes fields; never changes presentation. */
  onAddType: (typeId: string) => void;
  /** Drops a member type; its property values stay dormant (ADR-0016 §6). */
  onRemoveType: (typeId: string) => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onSetProperty: (fieldId: string, value: PropertyValue) => void;
  onClearProperty: (fieldId: string) => void;
  onOpenCardPanel: (cardId: string) => void;
  onManageTypes: () => void;
  onFocusCard: (boardId: string) => void;
  onFocusSection: (sectionId: string) => void;
  /** Puts an unplaced card on the active board and pans to it. */
  onPlace: () => void;
  onRemoveFromBoard: () => void;
  onFocusLink: (cardId: string, boardId: string | null) => void;
}

export function useCardPanelModel(
  cardId: string | null,
  surface: CardSurface,
): CardPanelModel | null {
  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const focusCard = useUiStore((state) => state.focusCard);
  const focusSection = useUiStore((state) => state.focusSection);
  const openInspector = useUiStore((state) => state.openInspector);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const { screenToFlowPosition } = useReactFlow();

  const peers = useBoardPeers(activeBoardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const countOf = useReferenceCounts();
  const card = cardId ? snapshot.cards.find((entry) => entry.id === cardId) : undefined;
  // Field ids whose block is in the body, for the Show/Remove toggle.
  const title = useCardTitle(card?.id ?? "");
  const containers = useCardContainers(card?.id ?? "");

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

  return {
    card,
    title,
    types: snapshot.types,
    tags: snapshot.tags,
    boards: snapshot.boards,
    fields,
    where,
    cards,
    links,
    contentId,
    titleId,
    cursorStore,
    localUser,
    peers,
    bodyEmpty,
    linkCount: countOf(card.id),
    cardDoc: workspace.doc,
    onStartEditing: (field) => startEditing(card.id, field, surface),
    onEditEnd: stopEditing,
    onSetType: (typeId) => {
      // Type membership is schema, which a board or card share may never change.
      // A primary switch keeps every other member: the extra types are fields,
      // not presentation (ADR-0053 §1).
      if (canManageSchema) workspace.setPrimaryType(card.id, typeId);
    },
    onAddType: (typeId) => {
      if (canManageSchema) workspace.addCardType(card.id, typeId);
    },
    onRemoveType: (typeId) => {
      if (canManageSchema) workspace.removeCardType(card.id, typeId);
    },
    onAddTag: (tagId) => {
      if (canEditContent) workspace.addCardTag(card.id, tagId);
    },
    onRemoveTag: (tagId) => {
      if (canEditContent) workspace.removeCardTag(card.id, tagId);
    },
    onCreateTag: (name) => {
      if (!canManageSchema) return;
      const tag = workspace.ensureTag(name);
      workspace.addCardTag(card.id, tag.id);
    },
    onSetProperty: (fieldId, value) => workspace.setProperty(card.id, fieldId, value),
    onClearProperty: (fieldId) => workspace.clearProperty(card.id, fieldId),
    onOpenCardPanel: (cardId) => {
      // A mention or property block may name a card this share leaves out.
      if (snapshot.cards.some((entry) => entry.id === cardId)) openInspector(cardId);
    },
    onManageTypes: openTypeSettings,
    onFocusCard: (boardId) => focusCard(card.id, boardId),
    onFocusSection: (sectionId) => {
      if (activeBoardId) focusSection(sectionId, activeBoardId);
    },
    onPlace: () => {
      if (!canEditLayout || !activeBoardId) return;
      // The same landing spot as a library Place: the middle of the board in
      // front of the reader, with the card's centre on it rather than its corner.
      const rect = document.querySelector('[data-testid="canvas-board"]')?.getBoundingClientRect();
      const centre = screenToFlowPosition({
        x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
        y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
      });
      workspace.placeCard(activeBoardId, card.id, {
        x: centre.x - DEFAULT_CARD_WIDTH / 2,
        y: centre.y - DEFAULT_CARD_HEIGHT / 2,
      });
      // Placing is only useful if the reader sees where it landed.
      focusCard(card.id, activeBoardId);
    },
    onRemoveFromBoard: () => {
      if (canEditLayout && activeBoardId) workspace.unplaceCard(activeBoardId, card.id);
    },
    onFocusLink: (cardId, boardId) => {
      // Links to cards outside the projection render inert; never navigate.
      if (!snapshot.cards.some((entry) => entry.id === cardId)) return;
      // An unplaced card has nothing to reveal, so the panel is the target.
      if (boardId) focusCard(cardId, boardId);
      else openInspector(cardId);
    },
  };
}
