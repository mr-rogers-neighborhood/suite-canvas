import type { Card, FieldDefinition, PropertyValue } from "@suite/graph";
import { isPropertyValueEmpty } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { fieldKindEntry } from "../field/fieldKindRegistry";
import { CardPicker, type CardPickerOption } from "./CardPicker";

const inputClass =
  "w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";

function asString(value: PropertyValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export interface FieldValueInputProps {
  field: FieldDefinition;
  value: PropertyValue | undefined;
  /** `null` clears the property. */
  onCommit: (value: PropertyValue | null) => void;
  /** Selectable cards for a `card` field. */
  cards?: readonly CardPickerOption[] | undefined;
  /**
   * Known boards, so a `board` value reads as the target's name. An id that is
   * not in the list is a deleted board, shown as "Unavailable board".
   */
  boards?: readonly { id: string; name: string }[] | undefined;
  /** The card being edited, so a `card` property cannot point at itself. */
  excludeCardId?: string | undefined;
  autoFocus?: boolean | undefined;
  /** Called after a commit or a cancel; the inline block uses it to close. */
  onDone?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  testId?: string | undefined;
  className?: string | undefined;
}

function DraftInput({
  field,
  value,
  onCommit,
  onDone,
  onCancel,
  autoFocus,
  testId,
  className,
}: FieldValueInputProps) {
  const [draft, setDraft] = useState(asString(value));
  const cancelled = useRef(false);

  useEffect(() => {
    setDraft(asString(value));
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      onCommit(null);
      onDone?.();
      return;
    }
    if (field.kind === "number") {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        onCommit(parsed);
        onDone?.();
      } else {
        onCancel?.();
      }
      return;
    }
    if (field.kind === "date") {
      if (isIsoDate(trimmed)) {
        onCommit(trimmed);
        onDone?.();
      } else {
        onCancel?.();
      }
      return;
    }
    onCommit(trimmed);
    onDone?.();
  };

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the value was just clicked; the caret belongs here.
      autoFocus={autoFocus}
      type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
      aria-label={field.name}
      data-testid={testId}
      className={className ?? inputClass}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          setDraft(asString(value));
          onCancel?.();
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const raw = event.currentTarget.value;
        if (raw !== asString(value)) commit(raw);
        else onDone?.();
      }}
    />
  );
}

/**
 * One editable control per field kind, shared by the card panel and the inline
 * property block. Keeping the parse and commit rules here is what stops the two
 * surfaces from disagreeing about numbers, dates or empty values.
 */
export function FieldValueInput({
  field,
  value,
  onCommit,
  cards,
  boards,
  excludeCardId,
  autoFocus,
  onDone,
  onCancel,
  testId,
  className,
}: FieldValueInputProps) {
  // A kind that registered its own editor takes precedence: that is what lets a
  // composite kind ship without editing this switch (ADR-0057).
  const registered = fieldKindEntry(field.kind);
  if (registered) {
    const Editor = registered.editor;
    return (
      <Editor
        field={field}
        value={value}
        onCommit={onCommit}
        autoFocus={autoFocus}
        testId={testId}
        className={className}
        onDone={onDone}
        onCancel={onCancel}
        cards={cards as readonly Card[] | undefined}
        excludeCardId={excludeCardId}
      />
    );
  }

  switch (field.kind) {
    case "text":
    case "date":
    case "number":
      return (
        <DraftInput
          field={field}
          value={value}
          onCommit={onCommit}
          autoFocus={autoFocus}
          testId={testId}
          className={className}
          onDone={onDone}
          onCancel={onCancel}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          aria-label={field.name}
          data-testid={testId}
          className="h-4 w-4 accent-[var(--ink)]"
          checked={value === true}
          onChange={(event) => {
            onCommit(event.target.checked ? true : null);
            onDone?.();
          }}
        />
      );
    case "card": {
      const available = (cards ?? []).filter((card) => card.id !== excludeCardId);
      return (
        <CardPicker
          cards={available}
          label={field.name}
          value={asString(value) || undefined}
          onChange={(cardId) => {
            onCommit(cardId);
            onDone?.();
          }}
          onClear={() => {
            onCommit(null);
            onDone?.();
          }}
        />
      );
    }
    case "board": {
      // The target is chosen when the portal is created; the value reads as the
      // board's name, and a deleted board reads as unavailable rather than as
      // an opaque id.
      const board = boards?.find((entry) => entry.id === value);
      return (
        <p
          className="text-[13px] text-[var(--ink)]"
          data-testid="property-board-value"
          data-missing={board ? undefined : "true"}
          title={board?.name ?? "Unavailable board"}
        >
          {board?.name ?? "Unavailable board"}
        </p>
      );
    }
    case "select": {
      const known = field.options.some((option) => option.id === value);
      return (
        <select
          // biome-ignore lint/a11y/noAutofocus: the value was just clicked; the caret belongs here.
          autoFocus={autoFocus}
          aria-label={field.name}
          data-testid={testId}
          className={className ?? inputClass}
          value={asString(value)}
          onChange={(event) => {
            onCommit(event.target.value.length > 0 ? event.target.value : null);
            onDone?.();
          }}
          onBlur={() => onDone?.()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel?.();
            }
          }}
        >
          <option value="">None</option>
          {typeof value === "string" && value.length > 0 && !known ? (
            <option value={value}>Unavailable option</option>
          ) : null}
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    case "multiSelect": {
      const selected = new Set(Array.isArray(value) ? value : []);
      return (
        <div className="flex flex-wrap gap-1">
          {field.options.map((option) => {
            const active = selected.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-label={`${field.name}: ${option.label}`}
                aria-pressed={active}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? "border-transparent bg-[var(--segmented-bg)] text-[var(--ink)]"
                    : "border-[var(--hairline)] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                }`}
                onClick={() => {
                  const next = active
                    ? [...selected].filter((id) => id !== option.id)
                    : [...selected, option.id];
                  if (next.length > 0) onCommit(next);
                  else onCommit(null);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }
  }
}

export interface PropertyFieldProps {
  field: FieldDefinition;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue) => void;
  onClear: () => void;
  /** Selectable cards for a `card` field. */
  cards?: readonly CardPickerOption[] | undefined;
  /** Known boards, so a `board` value reads as the target's name. */
  boards?: readonly { id: string; name: string }[] | undefined;
  /** The card being edited, so a `card` property cannot point at itself. */
  excludeCardId?: string | undefined;
}

/** The card panel's always-editable field; the block uses `FieldValueInput` directly. */
export function PropertyField({
  field,
  value,
  onChange,
  onClear,
  cards,
  boards,
  excludeCardId,
}: PropertyFieldProps) {
  return (
    <FieldValueInput
      field={field}
      value={value}
      onCommit={(next) => {
        if (next === null) onClear();
        else onChange(next);
      }}
      cards={cards}
      boards={boards}
      excludeCardId={excludeCardId}
    />
  );
}

/**
 * True when the value would render as blank. When a field is supplied, deleted
 * options, all-deleted multi-selects and dangling card values count as empty.
 */
export function isPropertyEmpty(
  value: PropertyValue | undefined,
  field?: FieldDefinition,
  availableCardIds?: ReadonlySet<string>,
): boolean {
  if (field) {
    const cardTitle =
      field.kind === "card" && typeof value === "string" && availableCardIds?.has(value)
        ? "present"
        : undefined;
    return isPropertyValueEmpty(field, value, { cardTitle });
  }
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  // An unchecked box is "not answered" for required-field purposes.
  if (typeof value === "boolean") return !value;
  return false;
}
