import type { Card, CardFieldView, CardType, PropertyValue, Tag } from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { CardBodyEditor, CardTitleEditor } from "./CardBodyEditor";
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

export interface CardPanelProps {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  fields: CardFieldView[];
  where: CardWhere;
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
  onManageTypes: () => void;
  onFocusCard: (boardId: string) => void;
  onFocusSection: (sectionId: string) => void;
  onRemoveFromBoard: () => void;
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
  onManageTypes,
  onFocusCard,
  onFocusSection,
  onRemoveFromBoard,
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
                    return (
                      <div
                        key={field.id}
                        className="block space-y-1"
                        data-testid={`property-${field.id}`}
                      >
                        <span className="flex items-center gap-1 text-[11px] text-[var(--ink-muted)]">
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
            cardDoc={cardDoc}
            contentId={contentId}
            // Only the surface that owns the body publishes carets; a read-only
            // twin must not clear the shared local cursor on its own updates.
            cursorStore={editing === "body" ? cursorStore : null}
            localUser={localUser}
            editable={editing === "body"}
            onFocus={keepFocusAlive}
            onBlur={releaseFocusSoon}
          />
        </div>
      </Section>
    </div>
  );
}
