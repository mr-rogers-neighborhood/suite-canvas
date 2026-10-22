import {
  arrowSources,
  type Board,
  type Card,
  type CardFieldView,
  type CardType,
  type GraphEdge,
  incomingReferences,
  outgoingReferences,
  type Placement,
  type PropertyValue,
  propertySources,
  type ReferenceIndex,
  type Tag,
} from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { useCanvasStore } from "../store/useCanvasStore";
import { CardBodyEditor, CardTitleEditor } from "./CardBodyEditor";
import type { CardPickerOption } from "./CardPicker";
import { PeerNameTag } from "./PeerNameTag";
import { isPropertyEmpty, PropertyField } from "./PropertyField";
import { TagPicker } from "./TagPicker";

export type CardPanelEditingField = "title" | "body";

export interface CardWhereSection {
  id: string;
  name: string;
  color?: string;
}

/** One board a card is placed on, with its section path on that board. */
export interface CardWhereEntry {
  boardId: string;
  boardName: string;
  isCurrent: boolean;
  isHome: boolean;
  sectionPath: CardWhereSection[];
}

/**
 * "Where is this card?" — derived from placements plus section geometry, so a
 * section rename or move updates the panel without any extra writes.
 */
export interface CardWhere {
  unplaced: boolean;
  entries: CardWhereEntry[];
}

/** A card row in the References section, already resolved for display. */
export interface CardReferenceRow {
  key: string;
  cardId: string;
  title: string;
  /** The card's type glyph. */
  glyph: string;
  /** Board to reveal on click; null means the card is unplaced. */
  boardId: string | null;
  boardName?: string;
  /** Text around the mention, when the source has one. */
  snippet?: string;
}

export interface CardPropertyReferenceRow extends CardReferenceRow {
  /** The `card` field whose name carries the link's meaning. */
  fieldName: string;
}

export interface CardArrowReferenceRow {
  key: string;
  edgeId: string;
  /** The endpoint that is not this card. */
  cardId: string;
  title: string;
  glyph: string;
  boardId: string;
  boardName: string;
  /** The arrow's free-text description. */
  description?: string;
}

/**
 * Backlinks, unioned at read time from the four sources that can point at a
 * card. Nothing here is stored: mentions, `card` values and arrows stay the
 * only truth.
 */
export interface CardReferences {
  incoming: CardReferenceRow[];
  outgoing: CardReferenceRow[];
  property: CardPropertyReferenceRow[];
  arrows: CardArrowReferenceRow[];
}

export const EMPTY_CARD_REFERENCES: CardReferences = {
  incoming: [],
  outgoing: [],
  property: [],
  arrows: [],
};

export interface CardReferenceInput {
  cardId: string;
  references: ReferenceIndex;
  cards: readonly Card[];
  types: readonly CardType[];
  edges: readonly GraphEdge[];
  placements: readonly Placement[];
  boards: readonly Board[];
  /** Live display title, including the body-first-line fallback. */
  displayTitle: (cardId: string) => string;
  /** Text around a mention; returning undefined omits the snippet. */
  mentionSnippet?: (sourceCardId: string, targetCardId: string) => string | undefined;
}

function typeGlyph(cardId: string, cards: readonly Card[], types: readonly CardType[]): string {
  const card = cards.find((entry) => entry.id === cardId);
  const primaryId = card?.primaryTypeId ?? card?.typeIds[0];
  const type = primaryId ? types.find((entry) => entry.id === primaryId) : undefined;
  return type?.glyph ?? "\u25a1";
}

function placementOf(
  cardId: string,
  placements: readonly Placement[],
  boards: readonly Board[],
): { boardId: string; boardName: string } | null {
  const placement = placements.find((entry) => entry.cardId === cardId);
  if (!placement) return null;
  const board = boards.find((entry) => entry.id === placement.boardId);
  return { boardId: placement.boardId, boardName: board?.name ?? "Board" };
}

/**
 * `cardText` trimmed to about `radius` characters either side of the first
 * occurrence of `needle`. Mentions are atoms, so a body can be missing the
 * target's title entirely; that case omits the snippet rather than inventing
 * one.
 */
export function snippetAround(text: string, needle: string, radius = 60): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = needle ? flat.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (at < 0) return undefined;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + needle.length + radius);
  const body = flat.slice(start, end).trim();
  return `${start > 0 ? "\u2026" : ""}${body}${end < flat.length ? "\u2026" : ""}`;
}

/**
 * Composes the panel's four groups from the snapshot. Pure so a host only needs
 * to hand over its data and the live title/text readers.
 */
export function cardReferences(input: CardReferenceInput): CardReferences {
  const { cardId, cards, types, placements, boards, displayTitle } = input;

  const row = (sourceId: string, prefix: string): CardReferenceRow => {
    const placement = placementOf(sourceId, placements, boards);
    return {
      key: `${prefix}:${sourceId}`,
      cardId: sourceId,
      title: displayTitle(sourceId),
      glyph: typeGlyph(sourceId, cards, types),
      boardId: placement?.boardId ?? null,
      ...(placement ? { boardName: placement.boardName } : {}),
    };
  };

  const byTitle = (a: { title: string; cardId: string }, b: { title: string; cardId: string }) =>
    a.title.localeCompare(b.title) || a.cardId.localeCompare(b.cardId);

  const incoming = incomingReferences(cardId, input.references).map((sourceId) => {
    const entry = row(sourceId, "in");
    const snippet = input.mentionSnippet?.(sourceId, cardId);
    return { ...entry, ...(snippet ? { snippet } : {}) };
  });

  const outgoing = outgoingReferences(cardId, input.references).map((targetId) =>
    row(targetId, "out"),
  );

  const property = propertySources(cardId, cards, types).map((source) => ({
    ...row(source.cardId, `field:${source.fieldId}`),
    key: `field:${source.cardId}:${source.fieldId}`,
    fieldName: source.fieldName,
  }));

  const arrows = arrowSources(cardId, input.edges).map((source) => {
    const board = boards.find((entry) => entry.id === source.boardId);
    return {
      key: `arrow:${source.edgeId}`,
      edgeId: source.edgeId,
      cardId: source.otherCardId,
      title: displayTitle(source.otherCardId),
      glyph: typeGlyph(source.otherCardId, cards, types),
      boardId: source.boardId,
      boardName: board?.name ?? "Board",
      ...(source.description ? { description: source.description } : {}),
    };
  });

  return {
    incoming: [...incoming].sort(byTitle),
    outgoing: [...outgoing].sort(byTitle),
    property: [...property].sort((a, b) => a.fieldName.localeCompare(b.fieldName) || byTitle(a, b)),
    arrows: [...arrows].sort(byTitle),
  };
}

const NO_BODY_FIELDS: readonly string[] = [];

/**
 * Field ids that already have a property block in the body. Body text changes
 * notify `observeTitle`, so the toggles stay in step with the canvas editor
 * without a second subscription type. Contents are compared, so an unchanged
 * set keeps its identity and does not re-render the panel.
 */
export function useBodyPropertyBlocks(cardId: string): readonly string[] {
  const workspace = useCanvasStore((state) => state.workspace);
  const last = useRef<readonly string[]>(NO_BODY_FIELDS);

  const subscribe = useCallback(
    (listener: () => void) => (cardId ? workspace.observeTitle(cardId, listener) : () => undefined),
    [workspace, cardId],
  );
  const get = useCallback(() => {
    const next = cardId ? workspace.bodyPropertyBlocks(cardId) : NO_BODY_FIELDS;
    const previous = last.current;
    if (
      previous.length === next.length &&
      previous.every((fieldId, index) => fieldId === next[index])
    ) {
      return previous;
    }
    last.current = next;
    return next;
  }, [workspace, cardId]);

  return useSyncExternalStore(subscribe, get, get);
}

export interface CardPanelProps {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  fields: CardFieldView[];
  where: CardWhere;
  /** Selectable cards for a `card` field's picker; memoised by the host. */
  cards: readonly CardPickerOption[];
  /** Everything that points at this card, derived by the host. */
  references: CardReferences;
  /** Inspector drawer or an embedded surface such as an expanded library row. */
  variant?: "inspector" | "embedded";
  /** Which field the panel currently owns; null keeps both read-only. */
  editing: CardPanelEditingField | null;
  cardDoc: LoroDoc;
  contentId: ContainerID;
  titleId: ContainerID;
  cursorStore: CursorEphemeralStore | null;
  localUser: PresenceUser | null;
  /** Peers on the active board, for the caret label and the editor halo. */
  peers: PeerPresence[];
  onStartEditing: (field: CardPanelEditingField) => void;
  onEditEnd: () => void;
  onSetType: (typeId: string) => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onSetProperty: (fieldId: string, value: PropertyValue) => void;
  onClearProperty: (fieldId: string) => void;
  /** Field ids that already have a block in the body. */
  bodyFields: readonly string[];
  /** Appends a property block for this field; an explicit user action. */
  onShowInBody: (fieldId: string) => void;
  /** Removes the block; the value itself stays on the card. */
  onHideFromBody: (fieldId: string) => void;
  /** Opens the card panel from a read-only property block. */
  onOpenCardPanel: (cardId: string) => void;
  onManageTypes: () => void;
  onFocusCard: (boardId: string) => void;
  onFocusSection: (sectionId: string) => void;
  onRemoveFromBoard: () => void;
  /** Reveal a referenced card, or open its inspector when it has no placement. */
  onFocusReference: (cardId: string, boardId: string | null) => void;
  /** Switch to the arrow's board and reveal the other endpoint. */
  onFocusArrow: (cardId: string, boardId: string) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-[var(--hairline)] px-3 py-3 first:border-t-0">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

const crumbClass =
  "min-w-0 truncate rounded px-0.5 text-[12px] text-[var(--ink)] underline-offset-2 hover:underline";

const referenceRowClass =
  "flex w-full min-w-0 items-start gap-1.5 rounded px-1 py-0.5 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10";

const referenceMetaClass = "mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]";

/** Rows are quiet by design: a glyph, a title, and one line of provenance. */
function ReferenceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-[11px] text-[var(--ink-muted)]">{title}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/** Second line: the snippet when there is one, then where the row goes. */
function referenceProvenance(snippet: string | undefined, place: string): string {
  return [snippet, place].filter((part): part is string => Boolean(part)).join(" \u00b7 ");
}

/**
 * The shared card surface: title, type, tags, properties, "Where", body.
 * Presentation only — every read is a prop and every write is a callback, so the
 * inspector shell, the library row and a future card tab can all host it.
 */
export function CardPanel({
  card,
  title,
  types,
  tags,
  fields,
  where,
  cards,
  references,
  variant = "inspector",
  editing,
  cardDoc,
  contentId,
  titleId,
  cursorStore,
  localUser,
  peers,
  onStartEditing,
  onEditEnd,
  onSetType,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onSetProperty,
  onClearProperty,
  bodyFields,
  onShowInBody,
  onHideFromBody,
  onOpenCardPanel,
  onManageTypes,
  onFocusCard,
  onFocusSection,
  onRemoveFromBoard,
  onFocusReference,
  onFocusArrow,
}: CardPanelProps) {
  // Blur can fire transiently while the panel re-renders (presence updates,
  // CRDT sync). Only leave edit mode when focus does not come back.
  const blurTimeout = useRef<number | null>(null);

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
    blurTimeout.current = window.setTimeout(() => {
      blurTimeout.current = null;
      onEditEnd();
    }, 120);
  };

  const typesById = new Map(types.map((type) => [type.id, type]));
  const groups = card.typeIds.length > 1 ? card.typeIds : [null];
  const current =
    where.entries.find((entry) => entry.isCurrent) ??
    where.entries.find((entry) => entry.isHome) ??
    where.entries[0] ??
    null;
  const others = where.entries.filter((entry) => entry.boardId !== current?.boardId);
  const currentSection = current?.sectionPath.at(-1) ?? null;

  const bodyPeers = peers.filter(
    (peer) => peer.focus?.nodeId === card.id && (peer.focus.field ?? "body") === "body",
  );
  const titlePeers = peers.filter(
    (peer) => peer.focus?.nodeId === card.id && peer.focus.field === "title",
  );
  const bodyPeer = bodyPeers[0]?.user ?? null;
  const titlePeer = titlePeers[0]?.user ?? null;

  const bodyPeerStyle: CSSProperties = bodyPeer
    ? { borderColor: bodyPeer.color, boxShadow: `0 0 0 2px ${bodyPeer.color}33` }
    : {};
  const titlePeerStyle: CSSProperties = titlePeer
    ? { borderColor: titlePeer.color, boxShadow: `0 0 0 2px ${titlePeer.color}33` }
    : {};

  const inspector = variant === "inspector";
  const hasReferences =
    references.incoming.length +
      references.outgoing.length +
      references.property.length +
      references.arrows.length >
    0;

  return (
    <div
      className={`card-panel ${inspector ? "card-panel-inspector" : "card-panel-embedded"}`}
      data-testid="card-panel"
      data-variant={variant}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the title overlay button starts editing; the editor owns keyboard input */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the title overlay button is the keyboard path */}
      <div
        className="card-panel-title relative mb-1 px-3 pt-3 pb-2"
        data-testid="card-panel-title"
        style={titlePeerStyle}
        onClick={(event) => {
          if (editing === "title") return;
          event.stopPropagation();
          onStartEditing("title");
        }}
      >
        {editing === "title" ? (
          <CardTitleEditor
            cardDoc={cardDoc}
            titleId={titleId}
            cursorStore={cursorStore}
            localUser={localUser}
            editable
            ariaLabel="Card panel title"
            onFocus={keepFocusAlive}
            onBlur={releaseFocusSoon}
            onCommit={onEditEnd}
          />
        ) : (
          <>
            <button
              type="button"
              aria-label="Edit card title"
              className="absolute inset-0 z-10 cursor-text"
              onClick={(event) => {
                event.stopPropagation();
                onStartEditing("title");
              }}
            />
            <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
              {title || "Untitled"}
            </p>
          </>
        )}
        {titlePeer ? <PeerNameTag user={titlePeer} className="card-peer-tag" /> : null}
      </div>

      <Section title="Type">
        <div className="flex flex-wrap gap-1" data-testid="type-picker">
          {types.map((type) => {
            const active = type.id === card.primaryTypeId;
            return (
              <button
                key={type.id}
                type="button"
                aria-pressed={active}
                data-testid={`type-option-${type.id}`}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? "border-transparent bg-[var(--segmented-bg)] text-[var(--ink)]"
                    : "border-[var(--hairline)] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                }`}
                onClick={() => onSetType(type.id)}
              >
                <span aria-hidden="true">{type.glyph}</span>
                {type.name}
              </button>
            );
          })}
          <button
            type="button"
            data-testid="manage-types"
            className="rounded-full px-2 py-0.5 text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
            onClick={onManageTypes}
          >
            Manage
          </button>
        </div>
      </Section>

      <Section title="Tags">
        <TagPicker
          tags={tags}
          selectedIds={card.tags}
          onAdd={onAddTag}
          onRemove={onRemoveTag}
          onCreate={onCreateTag}
        />
      </Section>

      <Section title="Properties">
        {fields.length === 0 ? (
          <p className="text-[12px] text-[var(--ink-muted)]">
            This type has no fields yet.{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-[var(--ink)]"
              onClick={onManageTypes}
            >
              Add one
            </button>
          </p>
        ) : (
          <div className="space-y-3" data-testid="property-list">
            {groups.map((typeId) => {
              const group = typeId ? fields.filter((entry) => entry.typeId === typeId) : fields;
              if (group.length === 0) return null;
              return (
                <div key={typeId ?? "single"} className="space-y-2">
                  {typeId ? (
                    <p className="text-[11px] text-[var(--ink-muted)]">
                      {typesById.get(typeId)?.name ?? "Type"}
                    </p>
                  ) : null}
                  {group.map(({ field }) => {
                    const value = card.properties[field.id];
                    const missing = field.required && isPropertyEmpty(value);
                    const inBody = bodyFields.includes(field.id);
                    return (
                      <div
                        key={field.id}
                        className="block space-y-1"
                        data-testid={`property-${field.id}`}
                      >
                        <span className="flex w-full items-center gap-1 text-[11px] text-[var(--ink-muted)]">
                          {field.name}
                          {missing ? (
                            <span
                              title="Required"
                              className="h-1.5 w-1.5 rounded-full bg-[var(--ink-muted)]"
                            />
                          ) : null}
                          <button
                            type="button"
                            data-testid={`body-toggle-${field.id}`}
                            aria-pressed={inBody}
                            title={
                              inBody
                                ? "Remove this field's block from the body; the value stays"
                                : "Show this field in the body as a compact block"
                            }
                            className="ml-auto rounded px-1 text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:bg-black/5 hover:underline dark:hover:bg-white/10"
                            onClick={() =>
                              inBody ? onHideFromBody(field.id) : onShowInBody(field.id)
                            }
                          >
                            {inBody ? "Remove from body" : "Show in body"}
                          </button>
                        </span>
                        <PropertyField
                          field={field}
                          value={value}
                          cards={cards}
                          onChange={(next) => onSetProperty(field.id, next)}
                          onClear={() => onClearProperty(field.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="References">
        <div className="space-y-2.5" data-testid="card-references">
          {hasReferences ? (
            <>
              {references.incoming.length > 0 ? (
                <ReferenceGroup title="Referenced by">
                  {references.incoming.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        data-testid="reference-incoming"
                        title={row.title}
                        className={referenceRowClass}
                        onClick={() => onFocusReference(row.cardId, row.boardId)}
                      >
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[12px] leading-5 text-[var(--ink-muted)]"
                        >
                          {row.glyph}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{row.title}</span>
                          <span className={referenceMetaClass}>
                            {referenceProvenance(row.snippet, row.boardName ?? "In the inbox")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ReferenceGroup>
              ) : null}

              {references.outgoing.length > 0 ? (
                <ReferenceGroup title="References">
                  {references.outgoing.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        data-testid="reference-outgoing"
                        title={row.title}
                        className={referenceRowClass}
                        onClick={() => onFocusReference(row.cardId, row.boardId)}
                      >
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[12px] leading-5 text-[var(--ink-muted)]"
                        >
                          {row.glyph}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{row.title}</span>
                          <span className={referenceMetaClass}>
                            {row.boardName ?? "In the inbox"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ReferenceGroup>
              ) : null}

              {references.property.length > 0 ? (
                <ReferenceGroup title="Linked from properties">
                  {references.property.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        data-testid="reference-property"
                        title={`${row.fieldName} \u00b7 ${row.title}`}
                        className={referenceRowClass}
                        onClick={() => onFocusReference(row.cardId, row.boardId)}
                      >
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[12px] leading-5 text-[var(--ink-muted)]"
                        >
                          {row.glyph}
                        </span>
                        <span className="flex min-w-0 flex-1 items-baseline gap-1">
                          <span className="shrink-0 text-[var(--ink-muted)]">{row.fieldName}</span>
                          <span aria-hidden="true" className="shrink-0 text-[var(--ink-muted)]">
                            {"\u00b7"}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{row.title}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ReferenceGroup>
              ) : null}

              {references.arrows.length > 0 ? (
                <ReferenceGroup title="Drawn to / from">
                  {references.arrows.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        data-testid="reference-arrow"
                        title={row.title}
                        className={referenceRowClass}
                        onClick={() => onFocusArrow(row.cardId, row.boardId)}
                      >
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[12px] leading-5 text-[var(--ink-muted)]"
                        >
                          {row.glyph}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{row.title}</span>
                          <span className={referenceMetaClass}>
                            {referenceProvenance(row.description, row.boardName)}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-[11px] leading-5 text-[var(--ink-muted)]"
                        >
                          {"\u2197"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ReferenceGroup>
              ) : null}
            </>
          ) : (
            <p className="text-[12px] text-[var(--ink-muted)]" data-testid="references-empty">
              No references yet. Type @ in a card to link it.
            </p>
          )}
        </div>
      </Section>

      <Section title="Where">
        {where.unplaced || !current ? (
          <p className="text-[12px] text-[var(--ink-muted)]" data-testid="card-where-empty">
            In the inbox
          </p>
        ) : (
          <ul
            className="space-y-1"
            data-testid={inspector ? "inspector-boards" : "card-where-boards"}
          >
            <li className="flex items-center gap-1 text-[12px]" data-testid="card-where-current">
              <span aria-hidden="true" className="text-[var(--ink-muted)]">
                {current.isHome ? "\u2302" : "\u2197"}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <button
                  type="button"
                  className={crumbClass}
                  onClick={() => onFocusCard(current.boardId)}
                >
                  {current.boardName}
                </button>
                <span aria-hidden="true" className="text-[var(--ink-muted)]">
                  {"\u203a"}
                </span>
                {currentSection ? (
                  current.sectionPath.map((section, index) => {
                    const deepest = index === current.sectionPath.length - 1;
                    return (
                      <span key={section.id} className="flex min-w-0 items-center gap-1">
                        <button
                          type="button"
                          data-testid={
                            deepest && inspector
                              ? "inspector-section"
                              : deepest
                                ? "card-where-section"
                                : undefined
                          }
                          className={`${crumbClass} flex items-center gap-1`}
                          onClick={() => onFocusSection(section.id)}
                        >
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: section.color ?? "var(--ink-muted)" }}
                          />
                          <span className="min-w-0 truncate">{section.name}</span>
                        </button>
                        {deepest ? null : (
                          <span aria-hidden="true" className="text-[var(--ink-muted)]">
                            {"\u203a"}
                          </span>
                        )}
                      </span>
                    );
                  })
                ) : (
                  <span
                    className="text-[var(--ink-muted)]"
                    data-testid={inspector ? undefined : "card-where-unsorted"}
                  >
                    Unsorted
                  </span>
                )}
              </span>
              <button
                type="button"
                className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onRemoveFromBoard}
              >
                Remove
              </button>
            </li>
            {others.map((entry) => (
              <li
                key={entry.boardId}
                className="flex items-center gap-1.5 text-[12px]"
                data-testid="card-where-board"
              >
                <span aria-hidden="true" className="text-[var(--ink-muted)]">
                  {entry.isHome ? "\u2302" : "\u2197"}
                </span>
                <button
                  type="button"
                  className={`${crumbClass} flex-1 text-left`}
                  onClick={() => onFocusCard(entry.boardId)}
                >
                  {entry.boardName}
                </button>
                <button
                  type="button"
                  className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => onFocusCard(entry.boardId)}
                >
                  Go
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Body">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a click on the read-only body moves the editable surface here */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the panel title and Edit button are the keyboard path */}
        <div
          className={`card-panel-body rounded border border-transparent ${
            editing === "body" ? "is-editing" : "cursor-text"
          }`}
          data-testid="card-panel-body"
          data-editing={editing === "body" ? "true" : undefined}
          style={bodyPeerStyle}
          onClick={(event) => {
            if (editing === "body") return;
            event.stopPropagation();
            onStartEditing("body");
          }}
        >
          {bodyPeer ? <PeerNameTag user={bodyPeer} className="card-peer-tag" /> : null}
          <CardBodyEditor
            cardId={card.id}
            cardDoc={cardDoc}
            contentId={contentId}
            // Only the surface that owns the body publishes carets; a read-only
            // twin must not clear the shared local cursor on its own updates.
            cursorStore={editing === "body" ? cursorStore : null}
            localUser={localUser}
            editable={editing === "body"}
            onFocus={keepFocusAlive}
            onBlur={releaseFocusSoon}
            onOpenCardPanel={onOpenCardPanel}
          />
        </div>
      </Section>
    </div>
  );
}
