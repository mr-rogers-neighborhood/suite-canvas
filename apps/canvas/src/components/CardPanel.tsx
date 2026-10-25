import {
  arrowSources,
  type Board,
  type Card,
  type CardFieldView,
  type CardType,
  formatPropertyValue,
  type GraphEdge,
  incomingReferences,
  outgoingPropertyLinks,
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
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { CardBodyEditor, CardTitleEditor } from "./CardBodyEditor";
import type { CardPickerOption } from "./CardPicker";
import { PeerNameTag } from "./PeerNameTag";
import { isPropertyEmpty, PropertyField } from "./PropertyField";
import { StyleTab } from "./surface/StyleTab";
import { TagPicker } from "./TagPicker";

export type CardPanelEditingField = "title" | "body";

/** Inspector tabs: metadata and relations, or the body itself. */
export type CardPanelTab = "details" | "content" | "style";

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
export type LinkProvenance = "mention" | "property" | "arrow";

/** One thing that links two cards: a mention, a named value, an arrow. */
export interface LinkOccurrence {
  key: string;
  kind: LinkProvenance;
  /** Mention snippet, arrow description, or the field name carrying a value. */
  detail?: string;
  boardId: string | null;
  boardName?: string;
}

/**
 * One related card with every occurrence grouped under it. A pair joined by a
 * mention, a named property and an arrow is one row with three markers, not
 * three rows the reader has to reconcile.
 */
export interface LinkRow {
  cardId: string;
  title: string;
  /** The other card's type glyph. */
  glyph: string;
  occurrences: LinkOccurrence[];
  /** Provenance present, in display order. */
  kinds: LinkProvenance[];
  /** The name a `card` field gives this link in this direction, when it has one. */
  relationship?: string;
  /** The pair links both ways: mutual mentions or a bidirectional arrow. */
  mutual: boolean;
  /** Board to reveal on click; null means the card is unplaced. */
  boardId: string | null;
  boardName?: string;
}

export interface CardLinks {
  incoming: LinkRow[];
  outgoing: LinkRow[];
}

export const EMPTY_CARD_LINKS: CardLinks = { incoming: [], outgoing: [] };

export interface CardLinkInput {
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

/**
 * `text` trimmed to about `radius` characters either side of the first
 * occurrence of `needle`. Mentions are atoms, so a body can name the target
 * without containing its title; that case returns undefined rather than
 * inventing a snippet.
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

/** The first board an unplaced-card row can reveal, if any. */
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

const KIND_ORDER: LinkProvenance[] = ["mention", "property", "arrow"];

/**
 * Groups every link a card has into incoming and outgoing lists keyed by the
 * other card. All of it is derived: mentions, `card` values and arrows stay the
 * only truth, so nothing here can drift out of sync with the body.
 */
export function cardLinks(input: CardLinkInput): CardLinks {
  const { cardId, cards, types, edges, placements, boards, displayTitle } = input;
  const byCard = new Map<"in" | "out", Map<string, LinkOccurrence[]>>([
    ["in", new Map()],
    ["out", new Map()],
  ]);

  const add = (
    direction: "in" | "out",
    otherCardId: string,
    kind: LinkProvenance,
    detail?: string,
    /** Arrow links live on the board the arrow was drawn on, not the other card's. */
    board?: { boardId: string; boardName: string },
  ) => {
    if (!otherCardId || otherCardId === cardId) return;
    const map = byCard.get(direction);
    if (!map) return;
    const list = map.get(otherCardId) ?? [];
    const placement = board ?? placementOf(otherCardId, placements, boards);
    list.push({
      key: `${direction}:${otherCardId}:${kind}:${detail ?? ""}:${list.length}`,
      kind,
      boardId: placement?.boardId ?? null,
      ...(placement ? { boardName: placement.boardName } : {}),
      ...(detail ? { detail } : {}),
    });
    map.set(otherCardId, list);
  };

  for (const sourceId of incomingReferences(cardId, input.references)) {
    add("in", sourceId, "mention", input.mentionSnippet?.(sourceId, cardId));
  }
  for (const targetId of outgoingReferences(cardId, input.references)) {
    add("out", targetId, "mention");
  }
  for (const source of propertySources(cardId, cards, types)) {
    add("in", source.cardId, "property", source.fieldName);
  }
  for (const link of outgoingPropertyLinks(cardId, cards, types)) {
    add("out", link.cardId, "property", link.fieldName);
  }
  for (const arrow of arrowSources(cardId, edges)) {
    const board = boards.find((entry) => entry.id === arrow.boardId);
    add(arrow.direction, arrow.otherCardId, "arrow", arrow.description, {
      boardId: arrow.boardId,
      boardName: board?.name ?? "Board",
    });
  }

  const rows = (direction: "in" | "out"): LinkRow[] => {
    const map = byCard.get(direction);
    if (!map) return [];
    const opposite = direction === "in" ? "out" : "in";
    return [...map].map(([otherCardId, occurrences]) => {
      const relationship = occurrences.find(
        (occurrence) => occurrence.kind === "property" && occurrence.detail,
      )?.detail;
      const placed = occurrences.find((occurrence) => occurrence.boardId !== null);
      const kinds = KIND_ORDER.filter((kind) =>
        occurrences.some((occurrence) => occurrence.kind === kind),
      );
      return {
        cardId: otherCardId,
        title: displayTitle(otherCardId),
        glyph: typeGlyph(otherCardId, cards, types),
        occurrences,
        kinds,
        mutual: byCard.get(opposite)?.has(otherCardId) ?? false,
        boardId: placed?.boardId ?? null,
        ...(placed?.boardName ? { boardName: placed.boardName } : {}),
        ...(relationship ? { relationship } : {}),
      };
    });
  };
  const byTitle = (a: LinkRow, b: LinkRow) =>
    a.title.localeCompare(b.title) || a.cardId.localeCompare(b.cardId);

  return {
    incoming: rows("in").sort(byTitle),
    outgoing: rows("out").sort(byTitle),
  };
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
  onSetType: (typeId: string) => void;
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

/**
 * A board value's reading: the live name when the board exists, otherwise the
 * explicit "missing" state. Other kinds carry no board reading.
 */
function boardReading(
  field: CardFieldView["field"],
  value: PropertyValue | undefined,
  boardNames: Map<string, string>,
): { boardName?: string; boardPresence?: "missing" } {
  if (field.kind !== "board" || typeof value !== "string") return {};
  const name = boardNames.get(value);
  return name ? { boardName: name } : { boardPresence: "missing" };
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

/** One row per related card; provenance rides along as quiet markers. */
const PROVENANCE: Record<LinkProvenance, { glyph: string; label: string }> = {
  mention: { glyph: "\u270e", label: "Mentioned in the body" },
  property: { glyph: "\u25a4", label: "Property value" },
  arrow: { glyph: "\u2197", label: "Arrow on a board" },
};

const occurrenceClass =
  "flex min-w-0 items-start gap-1 pl-4 pr-1 py-0.5 text-[11px] text-[var(--ink-muted)]";

function LinkRowItem({
  row,
  direction,
  onFocus,
  inert = false,
}: {
  row: LinkRow;
  direction: "in" | "out";
  onFocus: (cardId: string, boardId: string | null) => void;
  /** The card is not part of this share, so the row reads but does not navigate. */
  inert?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // One occurrence is already described on the row, so expanding only earns
  // its keep when a pair is joined more than once.
  const expandable = row.occurrences.length > 1;
  const single = row.occurrences.length === 1 ? row.occurrences[0]?.detail : undefined;
  const meta = [single ?? row.relationship, row.boardName]
    .filter((part): part is string => Boolean(part))
    .join(" \u00b7 ");

  const body = (
    <>
      <span aria-hidden="true" className="shrink-0 text-[12px] leading-5 text-[var(--ink-muted)]">
        {row.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{row.title}</span>
        {meta ? <span className={referenceMetaClass}>{meta}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 leading-5 text-[11px] text-[var(--ink-muted)]"
        data-testid="link-markers"
      >
        {row.kinds.map((kind) => PROVENANCE[kind].glyph).join("")}
        {row.mutual ? "\u2194" : ""}
      </span>
    </>
  );

  return (
    <li data-testid="link-row" data-direction={direction} data-card-id={row.cardId}>
      <div className="flex items-start gap-1">
        {inert ? (
          <span
            title={`${row.title} is not part of this share`}
            aria-disabled="true"
            data-testid="link-row-inert"
            className={`${referenceRowClass} cursor-default text-[var(--ink-muted)] opacity-70 hover:bg-transparent`}
          >
            {body}
          </span>
        ) : (
          <button
            type="button"
            title={row.title}
            className={referenceRowClass}
            onClick={() => onFocus(row.cardId, row.boardId)}
          >
            {body}
          </button>
        )}
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${row.occurrences.length} links to ${row.title}`}
            data-testid="link-occurrences-toggle"
            className="shrink-0 rounded px-1 text-[10px] leading-5 text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "\u25be" : "\u25b8"}
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="space-y-0.5" data-testid="link-occurrences">
          {row.occurrences.map((occurrence) => (
            <li
              key={occurrence.key}
              data-testid="link-occurrence"
              data-kind={occurrence.kind}
              className={occurrenceClass}
            >
              <span aria-hidden="true" className="shrink-0 leading-4">
                {PROVENANCE[occurrence.kind].glyph}
              </span>
              <span className="min-w-0 flex-1 truncate" title={occurrence.detail}>
                {occurrence.detail ?? PROVENANCE[occurrence.kind].label}
              </span>
              {occurrence.boardName ? (
                <span className="shrink-0">{occurrence.boardName}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function LinkGroup({
  title,
  direction,
  rows,
  onFocus,
  availableCardIds,
}: {
  title: string;
  direction: "in" | "out";
  rows: LinkRow[];
  onFocus: (cardId: string, boardId: string | null) => void;
  /** Cards this surface may open; the rest render as inert rows. */
  availableCardIds?: ReadonlySet<string>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-0.5" data-testid={`links-${direction}`}>
      <h3 className="text-[11px] text-[var(--ink-muted)]">{title}</h3>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <LinkRowItem
            key={row.cardId}
            row={row}
            direction={direction}
            onFocus={onFocus}
            {...(availableCardIds && !availableCardIds.has(row.cardId) ? { inert: true } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * The shared card surface. The inspector splits it into two tabs — Details
 * (type, tags, properties, links, where) and Content (the body) — so the body
 * is a destination of its own rather than a section below the metadata.
 * Presentation only: every read is a prop and every write is a callback.
 */
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
  // Blur can fire transiently while the panel re-renders (presence updates,
  // CRDT sync). Only leave edit mode when focus does not come back.
  const blurTimeout = useRef<number | null>(null);
  const focusedRow = useRef<HTMLDivElement | null>(null);

  const inspector = variant === "inspector";
  const idPrefix = useId();
  const detailsTabId = `${idPrefix}-details-tab`;
  const detailsPanelId = `${idPrefix}-details-panel`;
  const contentTabId = `${idPrefix}-content-tab`;
  const contentPanelId = `${idPrefix}-content-panel`;
  const styleTabId = `${idPrefix}-style-tab`;
  const stylePanelId = `${idPrefix}-style-panel`;
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
    blurTimeout.current = window.setTimeout(() => {
      blurTimeout.current = null;
      onEditEnd();
    }, 120);
  };

  const typesById = new Map(types.map((type) => [type.id, type]));
  const boardNames = new Map(boards.map((board) => [board.id, board.name]));
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

  const cardIds = useMemo(() => new Set(cards.map((entry) => entry.id)), [cards]);
  const hasLinks = links.incoming.length + links.outgoing.length > 0;
  const startEditing = (field: CardPanelEditingField) => {
    if (!editContent) return;
    onStartEditing(field);
  };

  const showDetails = !inspector || tab === "details";
  const showContent = !inspector || tab === "content";
  const showStyle = inspector && tab === "style";
  const bodySurface = (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the read-only body moves the editable surface here
    // biome-ignore lint/a11y/useKeyWithClickEvents: the panel title and Edit button are the keyboard path
    <div
      className={`card-panel-body ${editing === "body" ? "is-editing" : "cursor-text"}`}
      data-testid="card-panel-body"
      data-editing={editing === "body" ? "true" : undefined}
      style={bodyPeerStyle}
      onClick={(event) => {
        if (!editContent || editing === "body") return;
        event.stopPropagation();
        startEditing("body");
      }}
    >
      {bodyPeer ? <PeerNameTag user={bodyPeer} className="card-peer-tag" /> : null}
      {contentId === null ? (
        <p className="text-[13px] text-[var(--ink-muted)]" data-testid="card-panel-empty-body">
          No content yet.
        </p>
      ) : (
        <CardBodyEditor
          cardId={card.id}
          cardDoc={cardDoc}
          contentId={contentId}
          // Only the surface that owns the body publishes carets; a read-only
          // twin must not clear the shared local cursor on its own updates.
          cursorStore={editing === "body" ? cursorStore : null}
          localUser={localUser}
          editable={editContent && editing === "body"}
          readOnly={!editContent}
          ariaLabel="Note body"
          onFocus={keepFocusAlive}
          onBlur={releaseFocusSoon}
          onOpenCardPanel={onOpenCardPanel}
        />
      )}
    </div>
  );

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
          if (!editContent || editing === "title") return;
          event.stopPropagation();
          startEditing("title");
        }}
      >
        {editing === "title" && titleId ? (
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
            {editContent ? (
              <button
                type="button"
                aria-label="Edit card title"
                className="absolute inset-0 z-10 cursor-text"
                onClick={(event) => {
                  event.stopPropagation();
                  startEditing("title");
                }}
              />
            ) : null}
            <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
              {title || "Untitled"}
            </p>
          </>
        )}
        {titlePeer ? <PeerNameTag user={titlePeer} className="card-peer-tag" /> : null}
      </div>

      {inspector ? (
        <div className="card-panel-tabs px-3 pb-2" data-testid="card-panel-tabs">
          <div role="tablist" aria-label="Card sections" className="segmented">
            <button
              type="button"
              role="tab"
              id={detailsTabId}
              aria-controls={detailsPanelId}
              aria-selected={tab === "details"}
              data-testid="card-panel-tab-details"
              className="segmented-option"
              data-checked={tab === "details" ? "true" : undefined}
              onClick={() => selectTab("details")}
            >
              Details
            </button>
            <button
              type="button"
              role="tab"
              id={contentTabId}
              aria-controls={contentPanelId}
              aria-selected={tab === "content"}
              data-testid="card-panel-tab-content"
              className="segmented-option"
              data-checked={tab === "content" ? "true" : undefined}
              onClick={() => selectTab("content")}
            >
              Content
            </button>
            <button
              type="button"
              role="tab"
              id={styleTabId}
              aria-controls={stylePanelId}
              aria-selected={tab === "style"}
              data-testid="card-panel-tab-style"
              className="segmented-option"
              data-checked={tab === "style" ? "true" : undefined}
              onClick={() => selectTab("style")}
            >
              Style
            </button>
          </div>
        </div>
      ) : null}

      {showDetails ? (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is set whenever the aria attributes are.
        <div
          data-testid="card-panel-details"
          role={inspector ? "tabpanel" : undefined}
          id={inspector ? detailsPanelId : undefined}
          aria-labelledby={inspector ? detailsTabId : undefined}
        >
          <Section title="Type">
            {!manageSchema ? (
              <div className="flex flex-wrap gap-1" data-testid="type-picker" data-readonly="true">
                {card.typeIds.map((typeId) => {
                  const type = typesById.get(typeId);
                  return type ? (
                    <span
                      key={type.id}
                      data-testid={`type-view-${type.id}`}
                      className="flex items-center gap-1 rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
                    >
                      <span aria-hidden="true">{type.glyph}</span>
                      {type.name}
                    </span>
                  ) : null;
                })}
              </div>
            ) : (
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
                {manageSchema ? (
                  <button
                    type="button"
                    data-testid="manage-types"
                    className="rounded-full px-2 py-0.5 text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
                    onClick={onManageTypes}
                  >
                    Manage
                  </button>
                ) : null}
              </div>
            )}
          </Section>

          <Section title="Tags">
            {!editContent ? (
              <div className="flex flex-wrap gap-1" data-testid="tag-list" data-readonly="true">
                {tags
                  .filter((tag) => card.tags.includes(tag.id))
                  .map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
                    >
                      #{tag.name}
                    </span>
                  ))}
              </div>
            ) : (
              <TagPicker
                tags={tags}
                selectedIds={card.tags}
                onAdd={onAddTag}
                onRemove={onRemoveTag}
                onCreate={onCreateTag}
                allowCreate={manageSchema}
              />
            )}
          </Section>

          <Section title="Properties">
            {fields.length === 0 ? (
              <p className="text-[12px] text-[var(--ink-muted)]">
                This type has no fields yet.
                {manageSchema ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-[var(--ink)]"
                      onClick={onManageTypes}
                    >
                      Add one
                    </button>
                  </>
                ) : null}
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
                        const missing = field.required && isPropertyEmpty(value, field, cardIds);
                        if (!editContent) {
                          return (
                            <div
                              key={field.id}
                              ref={field.id === focusedField ? focusedRow : undefined}
                              className="property-row block space-y-1"
                              data-focused={field.id === focusedField ? "true" : undefined}
                              data-testid={`property-${field.id}`}
                            >
                              <span className="flex w-full items-center gap-1 text-[11px] text-[var(--ink-muted)]">
                                {field.name}
                              </span>
                              <p
                                className="text-[13px] text-[var(--ink)]"
                                data-testid={`property-value-${field.id}`}
                              >
                                {formatPropertyValue(field, value, {
                                  cardTitle:
                                    typeof value === "string"
                                      ? cards.find((entry) => entry.id === value)?.title
                                      : undefined,
                                  ...boardReading(field, value, boardNames),
                                })}
                              </p>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={field.id}
                            ref={field.id === focusedField ? focusedRow : undefined}
                            className="property-row block space-y-1"
                            data-focused={field.id === focusedField ? "true" : undefined}
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
                            </span>
                            <PropertyField
                              field={field}
                              value={value}
                              cards={cards}
                              boards={boards}
                              excludeCardId={card.id}
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

          <Section title="Links">
            <div className="space-y-2.5" data-testid="card-links">
              {hasLinks ? (
                <>
                  <LinkGroup
                    title="Incoming"
                    direction="in"
                    rows={links.incoming}
                    onFocus={onFocusLink}
                    {...(inertLinks ? { availableCardIds: cardIds } : {})}
                  />
                  <LinkGroup
                    title="Outgoing"
                    direction="out"
                    rows={links.outgoing}
                    onFocus={onFocusLink}
                    {...(inertLinks ? { availableCardIds: cardIds } : {})}
                  />
                </>
              ) : (
                <p className="text-[12px] text-[var(--ink-muted)]" data-testid="links-empty">
                  No links yet. Type @ in a card, or draw an arrow between two cards.
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
                <li
                  className="flex items-center gap-1 text-[12px]"
                  data-testid="card-where-current"
                >
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
                  {editLayout ? (
                    <button
                      type="button"
                      className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={onRemoveFromBoard}
                    >
                      Remove
                    </button>
                  ) : null}
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
        </div>
      ) : null}

      {showContent ? (
        inspector ? (
          <div
            className="px-3 py-3"
            data-testid="card-panel-content"
            role="tabpanel"
            id={contentPanelId}
            aria-labelledby={contentTabId}
          >
            {bodySurface}
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
          id={stylePanelId}
          aria-labelledby={styleTabId}
        >
          <StyleTab kind="card" id={card.id} canEdit={editLayout} />
        </div>
      ) : null}
    </div>
  );
}
