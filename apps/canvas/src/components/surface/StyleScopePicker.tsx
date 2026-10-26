import type { StyleRule, StyleRuleScope } from "@suite/graph";
import type { StyledSurfaceKind } from "../../canvas/styleTargets";
import { SHELL_REGION_LABELS } from "../../canvas/styleTargets";

/** What the reader is currently editing, as the picker reports it. */
export type StyleScopeChoice =
  | { rung: "surface" }
  | { rung: "type"; typeId: string }
  | { rung: "kind"; kind: StyledSurfaceKind }
  | { rung: "global" }
  | { rung: "shell"; region: string };

const SURFACE_LABELS: Record<StyledSurfaceKind, string> = {
  card: "this card",
  section: "this section",
  board: "this board",
  edge: "this link",
};

const KIND_LABELS_OPT: Record<StyledSurfaceKind, string> = {
  card: "every card",
  section: "every section",
  board: "every board",
  edge: "every link",
};

/** The value a `<select>` carries for a choice: stable, and readable in a test. */
export function scopeValue(choice: StyleScopeChoice): string {
  switch (choice.rung) {
    case "surface":
      return "surface";
    case "type":
      return `type:${choice.typeId}`;
    case "kind":
      return `kind:${choice.kind}`;
    case "global":
      return "global";
    case "shell":
      return `shell:${choice.region}`;
  }
}

/** The scope a choice writes, or null when it writes the surface itself. */
export function scopeOfChoice(choice: StyleScopeChoice): StyleRuleScope | null {
  switch (choice.rung) {
    case "surface":
      return null;
    case "type":
      return { kind: "type", id: choice.typeId };
    case "kind":
      return { kind: "kind", id: choice.kind };
    case "global":
      return { kind: "global" };
    case "shell":
      return { kind: "shell", id: choice.region };
  }
}

export interface StyleScopePickerProps {
  kind: StyledSurfaceKind;
  /** The card's primary type, when it has one: a section has nothing of the sort. */
  typeId?: string | null | undefined;
  typeName?: string | null | undefined;
  choice: StyleScopeChoice;
  rules: readonly StyleRule[];
  canEdit: boolean;
  onChange: (choice: StyleScopeChoice) => void;
  /** Opens the rule list. Absent when the host has no dialog to offer. */
  onManageRules?: (() => void) | undefined;
}

/**
 * "This applies to: [this card]" — the one control that reaches every rung
 * ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md) amendment).
 *
 * It exists because the alternative is two editors: one in the inspector that paints a card, and one in
 * settings that paints a rule. Those drift, and a reader has to learn which is which. Here the *target*
 * changes and the controls underneath do not — so "make every Concept look like this" is the same gesture
 * as "make this card rounded", said one rung up.
 *
 * **Choosing a rung writes nothing.** The rule is created by the first edit (see the draft hook), so
 * browsing the list never litters the document with rules that name nothing.
 */
export function StyleScopePicker({
  kind,
  typeId = null,
  typeName = null,
  choice,
  rules,
  canEdit,
  onChange,
  onManageRules,
}: StyleScopePickerProps) {
  const scope = scopeOfChoice(choice);
  const existing = scope ? rules.find((rule) => sameScopeAs(rule, scope)) : null;
  const options: Array<{ choice: StyleScopeChoice; label: string }> = [
    { choice: { rung: "surface" }, label: SURFACE_LABELS[kind] },
  ];
  if (kind === "card" && typeId) {
    options.push({
      choice: { rung: "type", typeId },
      label: `every ${typeName ?? "card of this type"}`,
    });
  }
  options.push({ choice: { rung: "kind", kind }, label: KIND_LABELS_OPT[kind] });
  options.push({ choice: { rung: "global" }, label: "everywhere in this workspace" });

  return (
    <div className="style-tab__scope" data-testid="style-scope">
      <label className="style-tab__row">
        <span>Applies to</span>
        <select
          data-testid="style-scope-select"
          value={scopeValue(choice)}
          disabled={!canEdit}
          onChange={(event) => {
            const next = options.find((entry) => scopeValue(entry.choice) === event.target.value);
            if (next) onChange(next.choice);
          }}
        >
          {options.map((entry) => (
            <option key={scopeValue(entry.choice)} value={scopeValue(entry.choice)}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      {/*
        The blast radius, said before the edit rather than after it. A reader who switched to "every
        Concept" needs to know the next click is not about the card in front of them.
      */}
      {choice.rung === "surface" ? null : (
        <p className="style-tab__note" data-testid="style-scope-note">
          {existing
            ? `Editing a rule: ${existing.name}. Every surface it covers changes with you.`
            : "This will create a rule on your first change. Choosing a scope on its own changes nothing."}
        </p>
      )}

      {onManageRules ? (
        <button
          type="button"
          className="style-tab__link"
          data-testid="style-scope-manage"
          onClick={onManageRules}
        >
          Manage rules…
        </button>
      ) : null}
    </div>
  );
}

/** Same group of surfaces, without importing the resolver's own comparison. */
function sameScopeAs(rule: StyleRule, scope: StyleRuleScope): boolean {
  return rule.scope.kind === scope.kind && (rule.scope.id ?? "") === (scope.id ?? "");
}

/** The label a shell region reads as, for a rule list that groups them. */
export function regionLabel(region: string): string {
  return SHELL_REGION_LABELS[region] ?? region;
}
