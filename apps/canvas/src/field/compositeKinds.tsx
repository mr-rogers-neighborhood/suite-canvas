import type { Card, FieldDefinition, PropertyValue } from "@suite/graph";
import type { KeyboardEvent } from "react";
import type { CardPickerOption } from "../components/CardPicker";
import { FieldValueInput } from "../components/PropertyField";
import type { FieldEditorProps } from "./fieldKindRegistry";
import { registerFieldKind } from "./fieldKindRegistry";

/**
 * The composing kinds ([ADR-0057](../../../docs/decisions/0057-fields-can-compose.md)):
 * `rating` is a number with a presentation, `group` is a record of sub-values,
 * `list` is an ordered repeatable. Importing this module registers all three, so
 * the panel renders them without knowing they exist — that is the four-place
 * parity test the registry exists for.
 */

type SubField = NonNullable<FieldDefinition["subFields"]>[number];

const shellClass = "w-full text-[13px] text-[var(--ink)]";
const quietClass = "text-[11px] text-[var(--ink-muted)]";

/** Declared order, not insertion order: a Loro map does not keep one. */
function sortedSubFields(field: FieldDefinition): SubField[] {
  return [...(field.subFields ?? [])].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

/**
 * A sub-field as the built-in input expects it. Ids are scoped to the parent so
 * two groups can both have a "Page" sub-field without colliding.
 */
function subFieldDefinition(field: FieldDefinition, sub: SubField): FieldDefinition {
  return {
    id: `${field.id}:${sub.id}`,
    name: sub.name,
    kind: sub.kind,
    required: false,
    order: sub.order,
    options: [],
  };
}

function asRecord(value: PropertyValue | undefined): Record<string, PropertyValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asItems(value: PropertyValue | undefined): PropertyValue[] {
  return Array.isArray(value) ? value : [];
}

function ratingScale(field: FieldDefinition): number {
  const scale = field.rating?.scale;
  return typeof scale === "number" && Number.isFinite(scale) ? Math.max(1, Math.floor(scale)) : 5;
}

/** What an empty row holds: the value a list item starts from, never `null`. */
function blankItem(field: FieldDefinition): PropertyValue {
  if (field.itemKind === "group") return {};
  switch (field.subFields?.[0]?.kind) {
    case "number":
    case "rating":
      return 0;
    case "checkbox":
      return false;
    default:
      return "";
  }
}

/** One sub-field's editor: the built-in control for that kind, not a copy of it. */
function SubFieldValue({
  field,
  sub,
  value,
  onCommit,
  cards,
  excludeCardId,
}: {
  field: FieldDefinition;
  sub: SubField;
  value: PropertyValue | undefined;
  onCommit: (next: PropertyValue | null) => void;
  cards?: readonly Card[] | undefined;
  excludeCardId?: string | undefined;
}) {
  return (
    <FieldValueInput
      field={subFieldDefinition(field, sub)}
      value={value}
      onCommit={onCommit}
      // The panel hands the picker its own minimal card shape; the same cast
      // happens on the way in (`PropertyField` casts it to `Card[]`).
      cards={cards as readonly CardPickerOption[] | undefined}
      excludeCardId={excludeCardId}
    />
  );
}

/** A bordered block of sub-fields; every edit writes the whole group value. */
function GroupFields({
  field,
  value,
  onChange,
  cards,
  excludeCardId,
  testId,
}: {
  field: FieldDefinition;
  value: PropertyValue | undefined;
  onChange: (next: Record<string, PropertyValue>) => void;
  cards?: readonly Card[] | undefined;
  excludeCardId?: string | undefined;
  testId?: string | undefined;
}) {
  const current = asRecord(value);
  const subs = sortedSubFields(field);
  return (
    <div
      className="space-y-1.5 rounded-lg border border-[var(--hairline)] p-2"
      data-testid={testId}
    >
      {subs.length === 0 ? <p className={quietClass}>This field has no sub-fields yet.</p> : null}
      {subs.map((sub) => (
        <div key={sub.id} className="flex items-center gap-2">
          <span className={`w-20 shrink-0 ${quietClass}`}>{sub.name}</span>
          <div className="min-w-0 flex-1">
            <SubFieldValue
              field={field}
              sub={sub}
              value={current[sub.id]}
              cards={cards}
              excludeCardId={excludeCardId}
              onCommit={(next) => {
                const draft = { ...current };
                // An empty sub-value is an absent one: a group stores what is
                // answered, and required stays advisory at every level.
                if (next === null) delete draft[sub.id];
                else draft[sub.id] = next;
                onChange(draft);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupEditor({
  field,
  value,
  onCommit,
  cards,
  excludeCardId,
  testId,
  className,
}: FieldEditorProps) {
  return (
    <div className={className ?? shellClass}>
      <GroupFields
        field={field}
        value={value}
        onChange={onCommit}
        cards={cards}
        excludeCardId={excludeCardId}
        testId={testId}
      />
    </div>
  );
}

/**
 * A rating writes a **number**, so sorting and arithmetic keep working; the
 * scale, the half steps and the icon set only change how it is drawn. The marks
 * are toggle buttons in a labelled group: Tab reaches each one, Enter or Space
 * picks it, and arrow keys move within the scale.
 */
function RatingEditor({ field, value, onCommit, testId, className }: FieldEditorProps) {
  const scale = ratingScale(field);
  const half = field.rating?.half === true;
  const icon = field.rating?.icon ?? "";
  const current = typeof value === "number" && Number.isFinite(value) ? value : 0;

  const steps: number[] = [];
  for (let mark = 1; mark <= scale; mark += 1) {
    if (half) steps.push(mark - 0.5);
    steps.push(mark);
  }

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, step: number): void => {
    const backwards = event.key === "ArrowLeft" || event.key === "ArrowDown";
    const forwards = event.key === "ArrowRight" || event.key === "ArrowUp";
    if (!backwards && !forwards) return;
    event.preventDefault();
    const index = steps.indexOf(step);
    const next = steps[index + (forwards ? 1 : -1)];
    if (next === undefined) return;
    const group = event.currentTarget.parentElement;
    const target = group?.querySelector<HTMLButtonElement>(`[data-rating-step="${next}"]`);
    target?.focus();
  };

  return (
    <div className={className ?? shellClass}>
      <fieldset className="m-0 flex flex-wrap items-center gap-0.5 border-0 p-0">
        <legend className="sr-only">{field.name}</legend>
        {steps.map((step) => {
          const checked = current === step;
          // Marks up to the value read as filled, so an icon set fills from the
          // left instead of lighting one glyph in the middle of the row.
          const filled = current > 0 && step <= current;
          return (
            <button
              key={step}
              type="button"
              aria-pressed={checked}
              aria-label={`${field.name}: ${step} of ${scale}`}
              data-rating-step={step}
              data-testid={testId ? `${testId}-${step}` : undefined}
              className={`min-w-6 rounded px-1 py-0.5 text-[13px] leading-none transition-colors ${
                filled ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
              } ${checked ? "bg-[var(--segmented-bg)]" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
              onClick={() => onCommit(checked ? null : step)}
              onKeyDown={(event) => moveFocus(event, step)}
            >
              {icon ? <span aria-hidden="true">{icon}</span> : step % 1 === 0 ? step : "½"}
            </button>
          );
        })}
        {current > 0 ? (
          <button
            type="button"
            aria-label={`Clear ${field.name}`}
            className={`ml-1 rounded px-1 py-0.5 ${quietClass} hover:bg-black/5 dark:hover:bg-white/10`}
            onClick={() => onCommit(null)}
          >
            Clear
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}

/**
 * A list writes the whole array on every change. The *storage* is a mergeable
 * movable list (ADR-0057 §5): the writer diffs the committed array against what
 * is stored and issues only the inserts and deletes that difference implies, so
 * concurrent appends keep both entries. The editor deliberately does not try to
 * be clever about indices — a commit is a value, not an operation.
 */
function ListEditor({
  field,
  value,
  onCommit,
  cards,
  excludeCardId,
  testId,
  className,
}: FieldEditorProps) {
  const items = asItems(value);
  const grouped = field.itemKind === "group";
  const itemSub = sortedSubFields(field)[0] ?? {
    id: "item",
    name: "Item",
    kind: "text" as const,
    order: 0,
  };

  const commit = (next: PropertyValue[]): void => {
    onCommit(next.length === 0 ? null : next);
  };

  return (
    <div className={className ?? shellClass} data-testid={testId}>
      <div className="space-y-1">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a row is a value, not an entity; position is the identity the writer diffs by.
          <div key={index} className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              {grouped ? (
                <GroupFields
                  field={field}
                  value={item}
                  cards={cards}
                  excludeCardId={excludeCardId}
                  onChange={(next) =>
                    commit(items.map((entry, at) => (at === index ? next : entry)))
                  }
                />
              ) : (
                <SubFieldValue
                  field={field}
                  sub={itemSub}
                  value={item}
                  cards={cards}
                  excludeCardId={excludeCardId}
                  onCommit={(next) =>
                    // A cleared scalar row keeps the item's blank value rather
                    // than vanishing: removing a row is the × button's job.
                    commit(
                      items.map((entry, at) => (at === index ? (next ?? blankItem(field)) : entry)),
                    )
                  }
                />
              )}
            </div>
            <button
              type="button"
              aria-label={`Remove ${field.name} item ${index + 1}`}
              className={`rounded px-1.5 py-0.5 ${quietClass} hover:bg-black/5 dark:hover:bg-white/10`}
              onClick={() => commit(items.filter((_, at) => at !== index))}
            >
              ×
            </button>
          </div>
        ))}
        {items.length === 0 ? <p className={quietClass}>No items yet.</p> : null}
        <button
          type="button"
          className="rounded-md border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => commit([...items, blankItem(field)])}
        >
          Add item
        </button>
      </div>
    </div>
  );
}

/** `7/10`: the number the field actually stores, with its scale. */
function formatRating(
  value: PropertyValue | undefined,
  field: FieldDefinition | undefined,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${value}/${field ? ratingScale(field) : 5}`;
}

/** A view counts rather than edits a composite field (ADR-0057 §5). */
function formatGroup(value: PropertyValue | undefined, field: FieldDefinition | undefined): string {
  if (!field) return "";
  const record = asRecord(value);
  const subs = sortedSubFields(field);
  const filled = subs.filter((sub) => record[sub.id] !== undefined).length;
  return filled === 0 ? "" : `${filled}/${subs.length} filled`;
}

function formatList(value: PropertyValue | undefined): string {
  const items = asItems(value);
  if (items.length === 0) return "";
  return items.length === 1 ? "1 item" : `${items.length} items`;
}

registerFieldKind({ kind: "rating", editor: RatingEditor, format: formatRating });
registerFieldKind({ kind: "group", editor: GroupEditor, format: formatGroup });
registerFieldKind({ kind: "list", editor: ListEditor, format: formatList });
