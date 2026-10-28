import { useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { IconPicker } from "../icons/IconPicker";

/**
 * One icon row, for every kind that can carry an icon.
 *
 * A card, a portal and a section all choose an icon the same way, so the row is one component: a
 * button showing what is set, a Clear that returns the entity to what it inherits, and the picker
 * behind it. The panel decides *what* the value means; this decides only how choosing reads.
 */
export function IconField({
  value,
  canEdit,
  onChange,
  testId = "icon",
}: {
  /** The resolved icon: what the entity would draw right now. */
  value: string | null;
  canEdit: boolean;
  /** `null` clears the choice, so the entity inherits again. */
  onChange: (icon: string | null) => void;
  /** Stem for the three test ids, so each panel keeps the name its specs know. */
  testId?: string;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <section className="mt-3" data-testid={testId}>
      <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">Icon</h3>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          data-testid={`${testId}-pick`}
          aria-expanded={choosing}
          disabled={!canEdit}
          className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--hairline)] px-2 text-[12px] text-[var(--ink)] disabled:opacity-40"
          onClick={() => setChoosing((open) => !open)}
        >
          {value ? (
            <IconGlyph icon={value} size={14} />
          ) : (
            <span aria-hidden="true">{"\u25ab"}</span>
          )}
          <span data-testid={`${testId}-label`}>{value ?? "Choose"}</span>
        </button>
        {value ? (
          <button
            type="button"
            data-testid={`${testId}-clear`}
            disabled={!canEdit}
            className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      {choosing ? (
        <div className="mt-1" data-testid={`${testId}-picker`}>
          <IconPicker
            value={value}
            inline={false}
            onPick={(icon) => {
              onChange(icon);
              setChoosing(false);
            }}
            onClose={() => setChoosing(false)}
          />
        </div>
      ) : null}
    </section>
  );
}
