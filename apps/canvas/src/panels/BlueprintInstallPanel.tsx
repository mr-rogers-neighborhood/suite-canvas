import type { CardType, FieldKind } from "@suite/graph";
import { useState } from "react";
import {
  type BlueprintFieldSpec,
  type BlueprintInstallParts,
  type BlueprintSpec,
  planBlueprintInstall,
} from "../canvas/blueprints/blueprint";

export interface BlueprintInstallPanelProps {
  spec: BlueprintSpec;
  /** The type that already carries the blueprint's name, when the workspace has one. */
  existingType: Pick<CardType, "id" | "name" | "fields"> | null;
  /** What to install. The host applies the plan through `applyBlueprintInstall`. */
  onInstall: (parts: BlueprintInstallParts) => void;
}

const KIND_LABELS: Partial<Record<FieldKind, string>> = {
  text: "text",
  number: "number",
  date: "date",
  select: "select",
  multiSelect: "multiple choice",
  checkbox: "checkbox",
  card: "card",
  board: "board",
  rating: "rating",
  group: "group",
  list: "list",
};

/**
 * The install control for a type blueprint (ADR-0059).
 *
 * The count in the footer is `planBlueprintInstall`'s own answer for the current
 * selection, so the button says what it is about to write rather than what the blueprint
 * claims. A field the type already declares is listed and marked as kept: hiding it would
 * leave the reader wondering where their field went.
 *
 * Every unit is a checkbox because a partial install is the normal case: one field, the
 * whole type, or only the starter content are separate asks, and the plan refuses a
 * request that asks for none of them.
 */
export function BlueprintInstallPanel({
  spec,
  existingType,
  onInstall,
}: BlueprintInstallPanelProps) {
  const [chosen, setChosen] = useState<readonly string[]>(() =>
    spec.fields.map((field) => field.name),
  );
  const [withContent, setWithContent] = useState(true);

  // No field means no type: a type with an empty field list and no content is not an
  // install anyone asked for.
  const wantsType = chosen.length > 0;

  const plan = planBlueprintInstall({
    spec,
    existingType,
    parts: { type: wantsType, fields: [...chosen], starterContent: withContent },
    // Ids are irrelevant to the preview, and a stable value keeps it a pure read.
    mintId: () => "preview",
  });

  const toggle = (name: string) => {
    setChosen((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  };

  const kept = new Set(
    (existingType?.fields ?? []).map((field) => field.name.trim().toLowerCase()),
  );

  return (
    <section
      className="flex max-w-[360px] flex-col gap-2 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink)]"
      data-testid="blueprint-install"
      aria-label={`Install ${spec.name}`}
    >
      <header className="flex items-baseline gap-2">
        <span className="font-medium">{spec.name}</span>
        <span className="text-[11px] text-[var(--ink-muted)]" data-testid="blueprint-version">
          {spec.version === null ? "Blueprint" : `Blueprint v${spec.version}`}
        </span>
      </header>

      {spec.fields.length > 0 ? (
        <fieldset className="flex flex-col gap-0.5 border-0 p-0">
          <legend className="text-[11px] text-[var(--ink-muted)]">Fields</legend>
          {spec.fields.map((field) => (
            <label key={field.name} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(field.name)}
                onChange={() => toggle(field.name)}
                data-testid={`blueprint-field-${field.name}`}
              />
              <span className="min-w-0 flex-1 truncate">{field.name}</span>
              <span className="text-[11px] text-[var(--ink-muted)]">{fieldKindLabel(field)}</span>
              {kept.has(field.name.trim().toLowerCase()) ? (
                <span
                  className="rounded-full bg-[var(--segmented-bg)] px-1.5 text-[11px]"
                  data-testid={`blueprint-kept-${field.name}`}
                >
                  kept
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
      ) : null}

      {spec.starterContent.trim() !== "" ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={withContent}
            onChange={() => setWithContent((value) => !value)}
            data-testid="blueprint-content"
          />
          <span>Start new cards with this content</span>
        </label>
      ) : null}

      <footer className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-[var(--segmented-bg)] px-2 py-1 disabled:opacity-50"
          data-testid="blueprint-install-button"
          // Nothing chosen means nothing to write; the plan says so and the button agrees.
          disabled={plan.kind === "empty"}
          onClick={() =>
            onInstall({ type: wantsType, fields: [...chosen], starterContent: withContent })
          }
        >
          Install
        </button>
        <span className="text-[11px] text-[var(--ink-muted)]" data-testid="blueprint-plan">
          {plan.kind === "install"
            ? `${plan.addFields.length} new ${plan.addFields.length === 1 ? "field" : "fields"}`
            : plan.kind === "up-to-date"
              ? "Nothing new in the type"
              : "Nothing selected"}
          {plan.reusedFields.length > 0 ? ` · ${plan.reusedFields.length} kept` : ""}
        </span>
      </footer>
    </section>
  );
}

function fieldKindLabel(field: BlueprintFieldSpec): string {
  return KIND_LABELS[field.kind] ?? field.kind;
}
