import type { Board, Card, CardFieldView, CardType, PropertyValue, Tag } from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { useEffect } from "react";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { useDrawing } from "../hooks/useDrawing";
import { PeerNameTag } from "../presence/PeerNameTag";
import { useCanvasStore } from "../store/useCanvasStore";
import { CardTitleEditor } from "./CardBodyEditor";
import { type CardLinks, CardPanel, type CardPanelEditingField, type CardWhere } from "./CardPanel";
import type { CardPickerOption } from "./CardPicker";
import {
  ensureWhiteboardType,
  isWhiteboardCard,
  readSketchDisplay,
  SKETCH_DISPLAY_FIELD_NAME,
  SKETCH_DISPLAY_MODES,
  type SketchDisplayMode,
  setSketchDisplay,
} from "./whiteboard";

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
  /** Makes `typeId` the primary type; the other members stay (ADR-0053 §1). */
  onSetType: (typeId: string) => void;
  /** Adds a type that only contributes fields. */
  onAddType?: ((typeId: string) => void) | undefined;
  /** Drops a member type; its values stay dormant. */
  onRemoveType?: ((typeId: string) => void) | undefined;
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
  /**
   * Puts this card on the board in front of the reader. Offered only while the
   * card has no placement here — a card that is already placed is located.
   */
  onPlace?: () => void;
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
  onPlace,
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
  // A sketch's Content tab is the drawing, so the panel needs the scene the card
  // face already reads. A non-sketch asks the document for nothing.
  const drawing = useDrawing(sketch ? card.id : null);
  // The toggle above is the sketch's control; the generic property row would
  // be a second, worse copy of the same value.
  const panelFields = sketch
    ? fields.filter((entry) => entry.field.name !== SKETCH_DISPLAY_FIELD_NAME)
    : fields;
  // Whoever else is editing this card's title gets the same ring here that the
  // panel paints on the canvas: the header is now the title, so it carries it.
  const titlePeer =
    peers.find((peer) => peer.focus?.nodeId === card.id && peer.focus.field === "title")?.user ??
    null;
  // Locate and Place are one pair of meanings, shared with the library rows: a
  // card on this board is located, a card that is not is placed.
  const currentBoard = where.entries.find((entry) => entry.isCurrent) ?? null;
  return (
    <aside
      className="card-inspector"
      data-testid="card-inspector"
      aria-label="Card info"
      data-handbook-region="card-inspector"
    >
      <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {/*
            One title, one control. The drawer's header *is* the card's title row,
            so the shared panel below no longer repeats it — a second editor for one
            value is the mistake the save pill was. The test id moved with the
            control, so every caller that renamed a card from the drawer still does.
          */}
          <div
            className="card-inspector-title"
            data-testid="card-panel-title"
            style={titlePeer ? { boxShadow: `0 0 0 2px ${titlePeer.color}33` } : undefined}
          >
            {editing === "title" && titleId ? (
              <CardTitleEditor
                cardDoc={cardDoc}
                titleId={titleId}
                cursorStore={cursorStore}
                localUser={localUser}
                editable
                ariaLabel="Card title"
                onCommit={onEditEnd}
              />
            ) : editContent ? (
              <button
                type="button"
                // The visible title *is* the name: an aria-label would have to
                // contain it anyway, and a name that repeats the text is noise.
                title="Edit card title"
                data-testid="inspector-title-edit"
                className="block w-full cursor-text truncate text-left text-[13px] font-semibold text-[var(--ink)]"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartEditing("title");
                }}
              >
                {title || "Untitled"}
              </button>
            ) : (
              <p className="truncate text-[13px] font-semibold text-[var(--ink)]" title={title}>
                {title || "Untitled"}
              </p>
            )}
            {titlePeer ? <PeerNameTag user={titlePeer} className="card-peer-tag" /> : null}
          </div>
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
        {currentBoard ? (
          <button
            type="button"
            aria-label="Locate this card on the board"
            data-testid="inspector-locate"
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => onFocusCard(currentBoard.boardId)}
          >
            Locate
          </button>
        ) : onPlace ? (
          <button
            type="button"
            aria-label="Place this card on the board"
            data-testid="inspector-place"
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onPlace}
          >
            Place
          </button>
        ) : null}
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

      <div className="card-inspector-scroll min-h-0 flex-1 overflow-y-auto">
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
          sketch={
            sketch
              ? {
                  elements: drawing?.elements ?? [],
                  onOpen: editContent ? onEdit : undefined,
                  label: title || "Sketch",
                }
              : undefined
          }
          cardDoc={cardDoc}
          contentId={contentId}
          titleId={titleId}
          cursorStore={cursorStore}
          localUser={localUser}
          peers={peers}
          onStartEditing={onStartEditing}
          onEditEnd={onEditEnd}
          onSetType={onSetType}
          onAddType={onAddType}
          onRemoveType={onRemoveType}
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
