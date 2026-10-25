import type { Board, Card, CardFieldView, CardType, PropertyValue, Tag } from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { useEffect } from "react";
import {
  ensureWhiteboardType,
  isWhiteboardCard,
  readSketchDisplay,
  SKETCH_DISPLAY_FIELD_NAME,
  SKETCH_DISPLAY_MODES,
  type SketchDisplayMode,
  setSketchDisplay,
} from "../cards/whiteboard";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { useCanvasStore } from "../store/useCanvasStore";
import { type CardLinks, CardPanel, type CardPanelEditingField, type CardWhere } from "./CardPanel";
import type { CardPickerOption } from "./CardPicker";

export interface CardInspectorProps {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  /** Known boards, so a portal's board field reads as a name. */
  boards?: readonly Board[] | undefined;
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
 * The sketch-specific part of the inspector: how the card paints, and the way
 * into its editor. Both are label-only additions — the value is an ordinary
 * property on the sketch's type, so nothing about the card record changes.
 */
function SketchDisplayControl({ card, disabled }: { card: Card; disabled: boolean }) {
  const workspace = useCanvasStore((state) => state.workspace);
  // Heals a workspace made before the rename: the Sketch labels and the
  // display field are added once, additively, and never touch the drawing.
  useEffect(() => {
    ensureWhiteboardType(workspace);
  }, [workspace]);
  const mode = readSketchDisplay(workspace, card);

  return (
    <fieldset
      className="flex min-w-0 items-center gap-1 border-b border-[var(--hairline)] px-3 py-1.5"
      aria-label="Sketch display"
      data-testid="sketch-display-toggle"
    >
      <span className="text-[11px] text-[var(--ink-muted)]">Display</span>
      {SKETCH_DISPLAY_MODES.map((option: SketchDisplayMode) => {
        const active = mode === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            data-testid={`sketch-display-${option}`}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
              active
                ? "border-transparent bg-[var(--segmented-bg)] text-[var(--ink)]"
                : "border-[var(--hairline)] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            }`}
            onClick={() => setSketchDisplay(workspace, card.id, option)}
          >
            {option === "framed" ? "Framed" : "Seamless"}
          </button>
        );
      })}
    </fieldset>
  );
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
  boards,
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
  const sketch = isWhiteboardCard(card);
  // The toggle above is the sketch's control; the generic property row would
  // be a second, worse copy of the same value.
  const panelFields = sketch
    ? fields.filter((entry) => entry.field.name !== SKETCH_DISPLAY_FIELD_NAME)
    : fields;
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
            aria-label={sketch ? "Open sketch" : "Edit card text"}
            data-testid={sketch ? "inspector-open-sketch" : "inspector-edit"}
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onEdit}
          >
            {sketch ? "Open sketch" : "Edit"}
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

      {sketch ? <SketchDisplayControl card={card} disabled={!editContent} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CardPanel
          card={card}
          title={title}
          types={types}
          tags={tags}
          boards={boards}
          fields={panelFields}
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
