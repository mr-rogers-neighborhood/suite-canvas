import {
  DEFAULT_DISPLAY_TEMPLATE,
  DISPLAY_PRESETS,
  type DisplayPreset,
  MAX_TEMPLATE_LENGTH,
  presetOf,
  type TemplateContext,
} from "@suite/graph";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ValueTemplate } from "../cards/ValueTemplate";
import { useEscapeLayer } from "../shell/escapeLayers";

export type DisplayScope = "field" | "instance";

export interface DisplayStyleDialogProps {
  /** Field name, shown in the title and used as the `{{label}}` sample. */
  fieldName: string;
  /** Sample context so the preview is a real value rather than placeholder text. */
  sample: TemplateContext;
  /** The template currently in effect (the field's, or this instance's). */
  template: string;
  /**
   * Whether "just this one" is offered. It is not, in type settings: there is no
   * single mention there to override.
   */
  allowScope?: boolean;
  /**
   * Whether the field-wide template may be written. A board or card draft only
   * owns its own atoms: the field belongs to the workspace schema.
   */
  allowFieldScope?: boolean;
  /** True when this instance already differs from its field. */
  overridden?: boolean;
  onApply: (template: string | null, scope: DisplayScope) => void;
  onClose: () => void;
}

const PRESET_LABELS: Record<DisplayPreset, string> = {
  value: "Value",
  labeled: "Label \u00b7 value",
  trailing: "Value \u00b7 label",
  carded: "@Card \u00b7 value",
};

const TOKEN_HINTS = [
  { token: "{{value}}", hint: "the value" },
  { token: "{{label}}", hint: "the field's name" },
  { token: "{{card}}", hint: "the card's title" },
  { token: "{{type}}", hint: "the card's type" },
];

/**
 * Edits how one field's value reads. Presentation only: this writes a template
 * on the field (or on one mention), never a value, so it cannot change what the
 * card stores.
 */
export function DisplayStyleDialog({
  fieldName,
  sample,
  template,
  allowScope = false,
  allowFieldScope = true,
  overridden = false,
  onApply,
  onClose,
}: DisplayStyleDialogProps) {
  const [draft, setDraft] = useState(template || DEFAULT_DISPLAY_TEMPLATE);
  const [scope, setScope] = useState<DisplayScope>(allowFieldScope ? "field" : "instance");

  useEscapeLayer(onClose);

  const preset = presetOf(draft);
  // Preview with the context's real value, so an empty field reads as it will.
  const preview = useMemo(() => sample, [sample]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close display settings"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Display for ${fieldName}`}
        data-testid="display-style"
        className="relative w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">{fieldName}</h2>
        <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
          How this value reads wherever it appears. The value itself never changes.
        </p>

        <div className="mt-3 flex flex-wrap gap-1" data-testid="display-presets">
          {(Object.keys(DISPLAY_PRESETS) as DisplayPreset[]).map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`display-preset-${id}`}
              aria-pressed={preset === id}
              className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                preset === id
                  ? "border-[var(--ink-muted)] bg-[var(--segmented-bg)] text-[var(--ink)]"
                  : "border-[var(--hairline)] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              }`}
              onClick={() => setDraft(DISPLAY_PRESETS[id])}
            >
              {PRESET_LABELS[id]}
            </button>
          ))}
        </div>

        <label
          className="mt-3 block text-[11px] text-[var(--ink-muted)]"
          htmlFor="display-template"
        >
          Template
        </label>
        <input
          id="display-template"
          data-testid="display-template-input"
          aria-label="Display template"
          className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
          maxLength={MAX_TEMPLATE_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--ink-muted)]">
          {TOKEN_HINTS.map((entry) => (
            <button
              key={entry.token}
              type="button"
              className="rounded px-0.5 hover:text-[var(--ink)]"
              title={entry.hint}
              onClick={() => setDraft((current) => `${current}${entry.token}`)}
            >
              {entry.token}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-[var(--hairline)] px-2 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
            Preview
          </p>
          <p className="text-[13px] text-[var(--ink)]">
            <ValueTemplate
              template={draft}
              context={preview}
              testId="display-preview"
              valueClassName="value-template__value"
            />
          </p>
        </div>

        {allowScope ? (
          <fieldset className="mt-3 space-y-1" data-testid="display-scope">
            <legend className="text-[11px] text-[var(--ink-muted)]">Apply to</legend>
            {allowFieldScope ? (
              <label className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="radio"
                  name="display-scope"
                  checked={scope === "field"}
                  onChange={() => setScope("field")}
                  data-testid="display-scope-field"
                />
                Every use of this field
              </label>
            ) : null}
            <label className="flex items-center gap-1.5 text-[12px]">
              <input
                type="radio"
                name="display-scope"
                checked={scope === "instance"}
                onChange={() => setScope("instance")}
                data-testid="display-scope-instance"
              />
              Just this one
            </label>
          </fieldset>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {overridden || template.trim() !== DEFAULT_DISPLAY_TEMPLATE ? (
            <button
              type="button"
              data-testid="display-reset"
              className="rounded-md px-2 py-1.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                onApply(null, scope);
                onClose();
              }}
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="display-save"
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] text-[var(--surface)] hover:opacity-90"
            onClick={() => {
              onApply(draft, scope);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
