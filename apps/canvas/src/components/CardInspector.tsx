import type { Card, CardFieldView, CardType, PropertyValue, Tag } from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { type CardLinks, CardPanel, type CardPanelEditingField, type CardWhere } from "./CardPanel";
import type { CardPickerOption } from "./CardPicker";

export interface CardInspectorProps {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  fields: CardFieldView[];
  where: CardWhere;
  /** Selectable cards for a `card` field's picker. */
  cards: readonly CardPickerOption[];
  /** Links from mentions, `card` values and arrows, grouped by card. */
  links: CardLinks;
  /** Field to reveal, when a link asked for one. */
  focusedField?: string | null;
  /** Whether the body has no text yet; a blank card opens on Content. */
  bodyEmpty?: boolean;
  /** Mentions, property links and arrows touching this card. */
  linkCount: number;
  editing: CardPanelEditingField | null;
  cardDoc: LoroDoc;
  contentId: ContainerID | null;
  titleId: ContainerID | null;
  cursorStore: CursorEphemeralStore | null;
  localUser: PresenceUser | null;
  peers?: PeerPresence[];
  onClose: () => void;
  /** Starts editing the card's body inside this panel. */
  onEdit: () => void;
  onStartEditing: (field: CardPanelEditingField) => void;
  onEditEnd: () => void;
  onSetType: (typeId: string) => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onSetProperty: (fieldId: string, value: PropertyValue) => void;
  onClearProperty: (fieldId: string) => void;
  onOpenCardPanel: (cardId: string) => void;
  onManageTypes: () => void;
  onFocusCard: (boardId: string) => void;
  onFocusSection: (sectionId: string) => void;
  onRemoveFromBoard: () => void;
  onFocusLink: (cardId: string, boardId: string | null) => void;
  /** A share viewer: the drawer keeps reading and navigation, nothing else. */
  readOnly?: boolean;
  canEditContent?: boolean;
  canEditLayout?: boolean;
  /** Types, fields, tags and card type reassignment. */
  canManageSchema?: boolean;
  restrictLinks?: boolean;
}

/**
 * The inspector drawer is a shell around the shared card surface; all card
 * content lives in `CardPanel` so the same surface can appear elsewhere.
 */
export function CardInspector({
  card,
  title,
  types,
  tags,
  fields,
  where,
  cards,
  links,
  linkCount,
  editing,
  cardDoc,
  contentId,
  titleId,
  cursorStore,
  localUser,
  peers = [],
  onClose,
  onEdit,
  onStartEditing,
  onEditEnd,
  onSetType,
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
  focusedField = null,
  bodyEmpty = false,
  readOnly = false,
  canEditContent,
  canEditLayout,
  canManageSchema,
  restrictLinks,
}: CardInspectorProps) {
  const editContent = canEditContent ?? !readOnly;
  return (
    <aside className="card-inspector" data-testid="card-inspector" aria-label="Card info">
      <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[var(--ink)]" title={title}>
            {title || "Untitled"}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
            <span>
              {where.unplaced
                ? "In the inbox"
                : `On ${where.entries.length} board${where.entries.length === 1 ? "" : "s"}`}
            </span>
            {linkCount > 0 ? (
              <span
                data-testid="inspector-link-count"
                title={`${linkCount} reference${linkCount === 1 ? "" : "s"}`}
              >
                {"↔"} {linkCount}
              </span>
            ) : null}
          </p>
        </div>
        {editContent ? (
          <button
            type="button"
            aria-label="Edit card text"
            data-testid="inspector-edit"
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onEdit}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Close card info"
          data-testid="inspector-close"
          className="rounded px-1.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CardPanel
          card={card}
          title={title}
          types={types}
          tags={tags}
          fields={fields}
          where={where}
          cards={cards}
          links={links}
          focusedField={focusedField}
          variant="inspector"
          bodyEmpty={bodyEmpty}
          editing={editing}
          cardDoc={cardDoc}
          contentId={contentId}
          titleId={titleId}
          cursorStore={cursorStore}
          localUser={localUser}
          peers={peers}
          onStartEditing={onStartEditing}
          onEditEnd={onEditEnd}
          onSetType={onSetType}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onCreateTag={onCreateTag}
          onSetProperty={onSetProperty}
          onClearProperty={onClearProperty}
          onOpenCardPanel={onOpenCardPanel}
          onManageTypes={onManageTypes}
          onFocusCard={onFocusCard}
          onFocusSection={onFocusSection}
          onRemoveFromBoard={onRemoveFromBoard}
          onFocusLink={onFocusLink}
          readOnly={readOnly}
          canEditContent={editContent}
          canEditLayout={canEditLayout ?? !readOnly}
          canManageSchema={canManageSchema ?? !readOnly}
          restrictLinks={restrictLinks ?? readOnly}
        />
      </div>
    </aside>
  );
}
