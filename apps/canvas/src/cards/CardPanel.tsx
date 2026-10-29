import {
  type Board,
  type Card,
  type CardFieldView,
  type CardType,
  type DrawingElement,
  isTutorialCard,
  type PropertyValue,
  type Tag,
} from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cardIcon as resolveCardIcon, setEntityIcon } from "../canvas/entityIcon";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { IconField } from "../inspector/IconField";
import { inspectorPanelIds } from "../inspector/InspectorTabs";
import { useCanvasStore } from "../store/useCanvasStore";
import { StyleTab } from "../styles/surface/StyleTab";
import { CardBodySurface } from "./CardBodySurface";
import { CardLinksSection } from "./CardLinksSection";
import { Section } from "./CardPanelSection";
import { CardPanelTabs } from "./CardPanelTabs";
import type { CardPickerOption } from "./CardPicker";
import { CardPlacementSection } from "./CardPlacementSection";
import { CardPropertiesSection } from "./CardPropertiesSection";
import { CardTitleSurface } from "./CardTitleSurface";
import { CardTypeTagsSection } from "./CardTypeTagsSection";
import type { CardLinks } from "./cardLinks";
import type { CardWhere } from "./cardWhere";
import { SketchPanel } from "./SketchPanel";
import { TutorialStepsPanel } from "./TutorialStepsPanel";
import { hasTourSteps } from "./tour";

export type {
  CardLinkInput,
  CardLinks,
  LinkOccurrence,
  LinkProvenance,
  LinkRow,
} from "./cardLinks";
export { cardLinks, EMPTY_CARD_LINKS, snippetAround } from "./cardLinks";
export type { CardWhere, CardWhereEntry, CardWhereSection } from "./cardWhere";

export type CardPanelEditingField = "title" | "body";

/** The drawing a sketch card holds, and the way into the surface that edits it. */
export interface CardPanelSketch {
  elements: readonly DrawingElement[];
  /** Absent for a session that may read the sketch but not open it. */
  onOpen?: (() => void) | undefined;
  label?: string | undefined;
}

/** Inspector tabs: metadata and relations, or the body itself. */
export type CardPanelTab = "details" | "content" | "style";

export interface CardPanelProps {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  fields: CardFieldView[];
  where: CardWhere;
  /** Selectable cards for a `card` field's picker; memoised by the host. */
  cards: readonly CardPickerOption[];
  /**
   * Known boards, so a `board` value (a portal's target) reads as a name. An id
   * that is not in this list is a deleted board and reads as unavailable.
   */
  boards?: readonly Board[] | undefined;
  /** Every link this card has, grouped and derived by the host. */
  links: CardLinks;
  /** Field the panel was asked to reveal; it scrolls into view and takes focus. */
  focusedField?: string | null;
  /** The inspector drawer, or a plain surface that stacks every section. */
  variant?: "inspector" | "embedded";
  /**
   * Whether the body has no text yet. A blank card opens on its Content tab so
   * the first keystroke lands where the reader expects it.
   */
  bodyEmpty?: boolean;
  /** Which field the panel currently owns; null keeps both read-only. */
  editing: CardPanelEditingField | null;
  /**
   * A sketch has no text body: what it holds is the drawing. When present, the
   * Content tab is the drawing itself instead of the body editor.
   */
  sketch?: CardPanelSketch | undefined;
  cardDoc: LoroDoc;
  /** Null when the projection has no body yet; readers then see static text. */
  contentId: ContainerID | null;
  titleId: ContainerID | null;
  cursorStore: CursorEphemeralStore | null;
  localUser: PresenceUser | null;
  /** Peers on the active board, for the caret label and the editor halo. */
  peers: PeerPresence[];
  onStartEditing: (field: CardPanelEditingField) => void;
  onEditEnd: () => void;
  /**
   * Makes `typeId` the primary type (ADR-0053 §1). The other members stay: a
   * primary switch is presentation, never a membership change.
   */
  onSetType: (typeId: string) => void;
  /**
   * Adds a type that only contributes fields. Optional on purpose: a host that
   * has not bound the additive action offers no "+ Type" control rather than a
   * control that silently does nothing.
   */
  onAddType?: ((typeId: string) => void) | undefined;
  /** Drops a non-primary type; its values stay dormant (ADR-0016 §6). */
  onRemoveType?: ((typeId: string) => void) | undefined;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onSetProperty: (fieldId: string, value: PropertyValue) => void;
  onClearProperty: (fieldId: string) => void;
  /** Opens the card panel from a read-only property block. */
  onOpenCardPanel: (cardId: string) => void;
  onManageTypes: () => void;
  onFocusCard: (boardId: string) => void;
  onFocusSection: (sectionId: string) => void;
  onRemoveFromBoard: () => void;
  /** Reveal a linked card, or open its inspector when it has no placement. */
  onFocusLink: (cardId: string, boardId: string | null) => void;
  /** A share viewer reads the card; nothing on this surface writes. */
  readOnly?: boolean;
  /** Title/body/properties/tags: true for an editor share. */
  canEditContent?: boolean;
  /** Board placement actions such as "Remove from board". */
  canEditLayout?: boolean;
  /** Schema and destructive actions; owner-only. */
  /** Types, fields, tags and card type reassignment. */
  canManageSchema?: boolean;
  /** A projection may not contain every linked card; those rows read inert. */
  restrictLinks?: boolean;
}
export function CardPanel({
  card,
  title,
  types,
  tags,
  fields,
  where,
  cards,
  boards = [],
  links,
  focusedField = null,
  variant = "inspector",
  bodyEmpty = false,
  editing,
  sketch,
  cardDoc,
  contentId,
  titleId,
  cursorStore,
  localUser,
  peers,
  onStartEditing,
  onEditEnd,
  onSetType,
  onAddType,
  onRemoveType,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onSetProperty,
  onClearProperty,
  onOpenCardPanel,
  onManageTypes,
  onFocusCard,
  onFocusSection,
  onRemoveFromBoard,
  onFocusLink,
  readOnly = false,
  canEditContent,
  canEditLayout,
  canManageSchema,
  restrictLinks,
}: CardPanelProps) {
  const editContent = canEditContent ?? !readOnly;
  const editLayout = canEditLayout ?? !readOnly;
  const manageSchema = canManageSchema ?? !readOnly;
  const inertLinks = restrictLinks ?? readOnly;
  // A tutorial's body is its timeline, so the content tab is its step list
  // (ADR-0058 §1). A card that already holds a step counts — an author who types
  // `/step` has started a tutorial without going to the type settings first.
  const tutorialCard = isTutorialCard(card, types) || hasTourSteps(cardDoc, contentId);
  // Blur can fire transiently while the panel re-renders (presence updates,
  // CRDT sync). Only leave edit mode when focus does not come back.
  const blurTimeout = useRef<number | null>(null);
  // A blur timer belongs to the field that lost focus. If another field starts
  // editing first, that timer must not stop the new one.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const focusedRow = useRef<HTMLDivElement | null>(null);

  const inspector = variant === "inspector";
  const idPrefix = useId();
  const [tab, setTab] = useState<CardPanelTab>(() => {
    if (editing === "body") return "content";
    if (focusedField) return "details";
    return bodyEmpty ? "content" : "details";
  });

  // A different card starts on the tab its body suggests: blank cards open
  // where the writing happens, cards with content open on their metadata.
  const tabCardId = useRef(card.id);
  useEffect(() => {
    if (tabCardId.current === card.id) return;
    tabCardId.current = card.id;
    setTab(bodyEmpty ? "content" : "details");
  }, [card.id, bodyEmpty]);

  // Edit and a click on the read-only body land on Content; a field the panel
  // was asked to reveal (a `@card.field` chip) lands on Details.
  const previousEditing = useRef(editing);
  useEffect(() => {
    if (editing === "body" && previousEditing.current !== "body") setTab("content");
    previousEditing.current = editing;
  }, [editing]);

  const previousFocusedField = useRef(focusedField);
  useEffect(() => {
    if (focusedField && focusedField !== previousFocusedField.current) setTab("details");
    previousFocusedField.current = focusedField;
  }, [focusedField]);

  const selectTab = (next: CardPanelTab) => {
    setTab(next);
    // Details hides the editor; leaving it must not keep the keystrokes.
    if (next === "details" && editing === "body") onEditEnd();
  };

  // A `@card.field` chip in any body opens this panel at that field, so the
  // value is one click from where it was read. Keyed by card too: the same
  // field id on a different card is a different target.
  const revealKey = focusedField ? `${card.id}:${focusedField}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab switch mounts the row this reveals.
  useEffect(() => {
    if (!revealKey) return;
    const row = focusedRow.current;
    if (!row) return;
    // jsdom has no layout, and no scrolling to do there either.
    row.scrollIntoView?.({ block: "nearest" });
    row.querySelector<HTMLElement>("input, select, button")?.focus();
  }, [revealKey, tab]);

  useEffect(
    () => () => {
      if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    },
    [],
  );

  const keepFocusAlive = () => {
    if (blurTimeout.current !== null) {
      window.clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
  };

  const releaseFocusSoon = () => {
    if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    const fieldAtBlur = editingRef.current;
    blurTimeout.current = window.setTimeout(() => {
      blurTimeout.current = null;
      if (editingRef.current !== fieldAtBlur) return;
      onEditEnd();
    }, 120);
  };

  const typesById = new Map(types.map((type) => [type.id, type]));
  // Fields union in type order with the primary first (ADR-0053 §2). The order
  // is presentation only: nothing below asks how many types there are.
  const cardTypeIds =
    card.primaryTypeId && card.typeIds.includes(card.primaryTypeId)
      ? [card.primaryTypeId, ...card.typeIds.filter((id) => id !== card.primaryTypeId)]
      : [...card.typeIds];

  const bodyPeers = peers.filter(
    (peer) => peer.focus?.nodeId === card.id && (peer.focus.field ?? "body") === "body",
  );
  const titlePeers = peers.filter(
    (peer) => peer.focus?.nodeId === card.id && peer.focus.field === "title",
  );
  const bodyPeer = bodyPeers[0]?.user ?? null;
  const titlePeer = titlePeers[0]?.user ?? null;
  const tabIds = inspectorPanelIds(idPrefix);

  const cardIds = useMemo(() => new Set(cards.map((entry) => entry.id)), [cards]);
  const startEditing = (field: CardPanelEditingField) => {
    if (!editContent) return;
    onStartEditing(field);
  };

  const showDetails = !inspector || tab === "details";
  const showContent = !inspector || tab === "content";
  const showStyle = inspector && tab === "style";

  const bodySurface = (
    <CardBodySurface
      cardId={card.id}
      cardDoc={cardDoc}
      contentId={contentId}
      cursorStore={cursorStore}
      localUser={localUser}
      editing={editing}
      editContent={editContent}
      peer={bodyPeer}
      onStartEditing={() => startEditing("body")}
      onFocus={keepFocusAlive}
      onBlur={releaseFocusSoon}
      onOpenCardPanel={onOpenCardPanel}
    />
  );

  return (
    <div
      className={`card-panel ${inspector ? "card-panel-inspector" : "card-panel-embedded"}`}
      data-testid="card-panel"
      data-variant={variant}
    >
      {/* The drawer draws the title in its own header, so this surface only owns
          one above the body when it stands alone (focus or embedded). */}
      {inspector ? null : (
        <CardTitleSurface
          title={title}
          cardDoc={cardDoc}
          titleId={titleId}
          cursorStore={cursorStore}
          localUser={localUser}
          editing={editing}
          editContent={editContent}
          peer={titlePeer}
          onStartEditing={() => startEditing("title")}
          onFocus={keepFocusAlive}
          onBlur={releaseFocusSoon}
          onCommit={onEditEnd}
        />
      )}

      {inspector ? (
        <CardPanelTabs
          tab={tab}
          tutorialCard={tutorialCard}
          idPrefix={idPrefix}
          onSelect={selectTab}
        />
      ) : null}

      {showDetails ? (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is set whenever the aria attributes are.
        <div
          data-testid="card-panel-details"
          role={inspector ? "tabpanel" : undefined}
          id={inspector ? tabIds.details.panel : undefined}
          aria-labelledby={inspector ? tabIds.details.tab : undefined}
        >
          {/* The same row a portal and a section have: what the card draws in its header. */}
          <IconField
            value={resolveCardIcon(card, typesById.get(card.primaryTypeId)?.icon)}
            canEdit={editLayout}
            testId="card-icon"
            // The Details tab pads nothing; every row in it carries its own gutter.
            inset
            onChange={(icon) => {
              const workspace = useCanvasStore.getState().workspace;
              if (workspace) setEntityIcon(workspace, { kind: "card", id: card.id }, icon);
            }}
          />

          <CardTypeTagsSection
            card={card}
            types={types}
            tags={tags}
            cardTypeIds={cardTypeIds}
            editContent={editContent}
            manageSchema={manageSchema}
            onSetType={onSetType}
            onAddType={onAddType}
            onRemoveType={onRemoveType}
            onManageTypes={onManageTypes}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onCreateTag={onCreateTag}
          />

          <CardPropertiesSection
            card={card}
            fields={fields}
            types={types}
            cards={cards}
            boards={boards}
            cardTypeIds={cardTypeIds}
            cardIds={cardIds}
            focusedField={focusedField}
            focusedRow={focusedRow}
            editContent={editContent}
            manageSchema={manageSchema}
            onSetProperty={onSetProperty}
            onClearProperty={onClearProperty}
            onManageTypes={onManageTypes}
          />

          <CardLinksSection
            links={links}
            onFocusLink={onFocusLink}
            {...(inertLinks ? { availableCardIds: cardIds } : {})}
          />

          <CardPlacementSection
            where={where}
            inspector={inspector}
            editLayout={editLayout}
            onFocusCard={onFocusCard}
            onFocusSection={onFocusSection}
            onRemoveFromBoard={onRemoveFromBoard}
          />
        </div>
      ) : null}

      {showContent ? (
        inspector ? (
          <div
            className="px-3 py-3"
            data-testid="card-panel-content"
            role="tabpanel"
            id={tabIds.content.panel}
            aria-labelledby={tabIds.content.tab}
          >
            {sketch ? (
              <SketchPanel
                elements={sketch.elements}
                onOpen={sketch.onOpen}
                label={sketch.label ?? "Sketch"}
              />
            ) : (
              <>
                {tutorialCard ? (
                  <TutorialStepsPanel
                    cardId={card.id}
                    cardDoc={cardDoc}
                    contentId={contentId}
                    canEdit={editContent}
                  />
                ) : null}
                {bodySurface}
              </>
            )}
          </div>
        ) : (
          <Section title="Body">{bodySurface}</Section>
        )
      ) : null}

      {showStyle ? (
        <div
          className="px-3 py-3"
          data-testid="card-panel-style"
          role="tabpanel"
          id={tabIds.style.panel}
          aria-labelledby={tabIds.style.tab}
        >
          <StyleTab
            targets={[{ kind: "card", id: card.id }]}
            canEdit={editLayout}
            typeName={typesById.get(card.primaryTypeId)?.name ?? null}
          />
        </div>
      ) : null}
    </div>
  );
}
