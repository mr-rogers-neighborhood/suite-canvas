import type { Card, CardFieldView, CardType, PropertyValue, Tag } from "@suite/graph";
import type { ReactNode } from "react";
import type { CardReference } from "../cards/cardReferences";
import { isPropertyEmpty, PropertyField } from "./PropertyField";
import { TagPicker } from "./TagPicker";

export interface CardInspectorProps {
  card: Card;
  title: string;
  types: CardType[];
  tags: Tag[];
  fields: CardFieldView[];
  references: CardReference[];
  /** Section the card belongs to on the active board, when any. */
  section?: { name: string; color?: string } | null;
  onClose: () => void;
  /** Starts editing the card's text on the canvas. */
  onEdit: () => void;
  onSetType: (typeId: string) => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onSetProperty: (fieldId: string, value: PropertyValue) => void;
  onClearProperty: (fieldId: string) => void;
  onManageTypes: () => void;
  onGoToBoard: (boardId: string) => void;
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

export function CardInspector({
  card,
  title,
  types,
  tags,
  fields,
  references,
  section = null,
  onClose,
  onEdit,
  onSetType,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  onSetProperty,
  onClearProperty,
  onManageTypes,
  onGoToBoard,
  onRemoveFromBoard,
}: CardInspectorProps) {
  const typesById = new Map(types.map((type) => [type.id, type]));
  const groups = card.typeIds.length > 1 ? card.typeIds : [null];

  return (
    <aside className="card-inspector" data-testid="card-inspector" aria-label="Card info">
      <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[var(--ink)]" title={title}>
            {title}
          </p>
          <p className="text-[11px] text-[var(--ink-muted)]">
            {references.length > 0
              ? `On ${references.length} board${references.length === 1 ? "" : "s"}`
              : "In the inbox"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Edit card on canvas"
          data-testid="inspector-edit"
          className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onEdit}
        >
          Edit
        </button>
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

        {section ? (
          <Section title="Section">
            <p className="flex items-center gap-1.5 text-[12px]" data-testid="inspector-section">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: section.color ?? "var(--ink-muted)" }}
              />
              <span className="min-w-0 flex-1 truncate">{section.name}</span>
            </p>
          </Section>
        ) : null}

        <Section title="On boards">
          {references.length === 0 ? (
            <p className="text-[12px] text-[var(--ink-muted)]">Not placed on a board.</p>
          ) : (
            <ul className="space-y-1" data-testid="inspector-boards">
              {references.map((reference) => (
                <li key={reference.boardId} className="flex items-center gap-1.5 text-[12px]">
                  <span aria-hidden="true" className="text-[var(--ink-muted)]">
                    {reference.isHome ? "\u2302" : "\u2197"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{reference.boardName}</span>
                  {reference.isCurrent ? (
                    <button
                      type="button"
                      className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={onRemoveFromBoard}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => onGoToBoard(reference.boardId)}
                    >
                      Go
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </aside>
  );
}
