import type { FieldDefinition, PropertyValue } from "@suite/graph";
import { useEffect, useState } from "react";

export interface PropertyFieldProps {
  field: FieldDefinition;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue) => void;
  onClear: () => void;
}

const inputClass =
  "w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";

function asString(value: PropertyValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Text-like inputs keep a local draft and commit on blur, so a property edit is
 * one CRDT write instead of one per keystroke.
 */
function DraftInput({
  value,
  type,
  label,
  onCommit,
}: {
  value: string;
  type: "text" | "number" | "date";
  label: string;
  onCommit: (draft: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      type={type}
      aria-label={label}
      className={inputClass}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function PropertyField({ field, value, onChange, onClear }: PropertyFieldProps) {
  switch (field.kind) {
    case "text":
      return (
        <DraftInput
          type="text"
          label={field.name}
          value={asString(value)}
          onCommit={(draft) => (draft ? onChange(draft) : onClear())}
        />
      );
    case "date":
      return (
        <DraftInput
          type="date"
          label={field.name}
          value={asString(value)}
          onCommit={(draft) => (draft ? onChange(draft) : onClear())}
        />
      );
    case "number":
      return (
        <DraftInput
          type="number"
          label={field.name}
          value={typeof value === "number" ? String(value) : ""}
          onCommit={(draft) => {
            if (!draft) {
              onClear();
              return;
            }
            const parsed = Number(draft);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          aria-label={field.name}
          className="h-4 w-4 accent-[var(--ink)]"
          checked={value === true}
          onChange={(event) => {
            if (event.target.checked) onChange(true);
            else onClear();
          }}
        />
      );
    case "select":
      return (
        <select
          aria-label={field.name}
          className={inputClass}
          value={asString(value)}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
            else onClear();
          }}
        >
          <option value="">None</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      );
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
                  if (next.length > 0) onChange(next);
                  else onClear();
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

/** True when the value would render as blank. */
export function isPropertyEmpty(value: PropertyValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  // An unchecked box is "not answered" for required-field purposes.
  if (typeof value === "boolean") return !value;
  return false;
}
