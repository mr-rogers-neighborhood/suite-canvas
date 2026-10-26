import type { StyleRule, StyleRuleScope, StyleScopeKind, SurfaceStyle } from "@suite/graph";
import { isEmptyStyle } from "@suite/graph";

/**
 * Where a style edit is going ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)
 * amendment, "the ladder is writable").
 *
 * The inspector's Style tab edits a *surface*; the same controls edit a *rule* when the scope picker says
 * "every Concept". Both are a target, so there is one editor rather than two that drift — which is the
 * property the whole style system has been built around.
 */
export type StyledSurfaceKind = "card" | "section" | "board" | "edge";

export type StyleTarget =
  | { rung: "surface"; kind: StyledSurfaceKind; id: string }
  | { rung: "rule"; ruleId: string };

/** The four shell regions a rule may name, in the order the chrome reads left to right. */
export const SHELL_REGION_LABELS: Record<string, string> = {
  "app-bar": "app bar",
  tabs: "board tabs",
  dock: "dock",
  drawer: "library",
};

/** The plural a kind rule reads as. */
export const KIND_LABELS: Record<StyledSurfaceKind, string> = {
  card: "card",
  section: "section",
  board: "board",
  edge: "link",
};

/** The rung labels, in resolution order, for grouping the list. */
export const SCOPE_ORDER: readonly StyleScopeKind[] = ["global", "type", "kind", "shell"];

/** The reader's words for a scope: "Every Concept", "Every card", "Everywhere". */
export function ruleNameFor(
  scope: StyleRuleScope,
  lookups: { typeName?: string | undefined; kindLabel?: string | undefined } = {},
): string {
  switch (scope.kind) {
    case "global":
      return "Everywhere";
    case "type":
      return `Every ${lookups.typeName ?? "card of this type"}`;
    case "kind":
      return `Every ${lookups.kindLabel ?? scope.id ?? "surface"}`;
    case "shell":
      return `Every ${SHELL_REGION_LABELS[scope.id ?? ""] ?? scope.id ?? "shell region"}`;
  }
}

/** Two scopes name the same group of surfaces. */
export function sameScope(left: StyleRuleScope, right: StyleRuleScope): boolean {
  return left.kind === right.kind && (left.id ?? "") === (right.id ?? "");
}

/** The rule that already speaks for a scope, if one does. */
export function ruleForScope(
  rules: readonly StyleRule[],
  scope: StyleRuleScope,
): StyleRule | undefined {
  return rules.find((rule) => sameScope(rule.scope, scope));
}

/** One past the last order, so a new rule sorts after everything it should lose to. */
export function nextRuleOrder(rules: readonly StyleRule[]): number {
  return rules.reduce((highest, rule) => Math.max(highest, rule.order + 1), 0);
}

/**
 * Rewrites one rule's assignments, leaving its name, order and scope alone.
 *
 * A rule that names nothing is kept rather than deleted: clearing every control is how a reader asks
 * "what would this look like if the rule said nothing?", and deleting is the list's own verb. Removing a
 * rule as a side effect of a reset is the kind of surprise that makes people stop editing.
 */
export function withRuleStyle(
  rules: readonly StyleRule[],
  ruleId: string,
  style: SurfaceStyle,
): StyleRule[] {
  return rules.map((rule) => (rule.id === ruleId ? { ...rule, style } : rule));
}

/**
 * The list with a rule for `scope` carrying `style`, created if the scope has none.
 *
 * This is what makes the scope picker safe to browse: choosing "every Concept" writes nothing, and the
 * first edit is what calls this. A new rule is named for its scope and ordered last, so it loses to every
 * rule that already existed — an edit cannot silently change what other rules were already deciding.
 */
export function upsertScopedRule(
  rules: readonly StyleRule[],
  input: {
    scope: StyleRuleScope;
    style: SurfaceStyle;
    name: string;
    id: string;
  },
): StyleRule[] {
  const existing = ruleForScope(rules, input.scope);
  if (existing) return withRuleStyle(rules, existing.id, input.style);
  return [
    ...rules,
    {
      id: input.id,
      name: input.name,
      order: nextRuleOrder(rules),
      scope: input.scope,
      style: input.style,
    },
  ];
}

/** Removing a rule, by id. */
export function withoutRule(rules: readonly StyleRule[], ruleId: string): StyleRule[] {
  return rules.filter((rule) => rule.id !== ruleId);
}

/**
 * Moving a rule one place in the resolution order.
 *
 * Order is the resolver's existing tie-breaker among equally specific rules (`order`, then id), so this is
 * a document write with no new semantics — the arrow the reader presses and the comparison the resolver
 * makes are the same number.
 */
export function moveRule(
  rules: readonly StyleRule[],
  ruleId: string,
  direction: -1 | 1,
): StyleRule[] {
  const sorted = [...rules].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = sorted.findIndex((rule) => rule.id === ruleId);
  const next = index + direction;
  if (index === -1 || next < 0 || next >= sorted.length) return [...rules];
  // The pair swaps places and the whole list is renumbered, so a list that arrived with duplicate orders
  // becomes one where the rules the reader just moved are unambiguous.
  const reordered = [...sorted];
  const [moved] = reordered.splice(index, 1);
  if (!moved) return [...rules];
  reordered.splice(next, 0, moved);
  // The list comes back in the order the reader just made, renumbered, so a caller that renders what it
  // wrote sees the same sequence `styleRules()` will hand back.
  return reordered.map((rule, position) => ({ ...rule, order: position }));
}

/** How many surfaces a rule speaks for, which is what "delete" would change. */
export function surfacesUnderRule(
  rule: StyleRule,
  cards: readonly { primaryTypeId?: string | undefined }[],
): number {
  switch (rule.scope.kind) {
    case "global":
    case "kind":
      return cards.length;
    case "type":
      return cards.filter((card) => card.primaryTypeId === rule.scope.id).length;
    case "shell":
      // One region, one surface: the region itself.
      return 1;
  }
}

/**
 * How many cards a promotion would actually change.
 *
 * A card's own style wins over every rule, so promoting "make every Concept look like this" changes only
 * the cards of that type that have no style of their own. Counting the type's whole population would
 * promise more than the write delivers, and a confirm that overstates its blast radius is one a reader
 * learns to ignore.
 */
export function cardsChangedByPromotion(
  cards: readonly { primaryTypeId?: string | undefined; style?: SurfaceStyle | undefined }[],
  typeId: string,
): number {
  return cards.filter((card) => card.primaryTypeId === typeId && isEmptyStyle(card.style)).length;
}

/** Whether a rule names anything at all, for the list's "names nothing yet" state. */
export function ruleNamesNothing(rule: StyleRule): boolean {
  return isEmptyStyle(rule.style);
}

/** The surface kind a target ultimately paints, for resolution and provenance. */
export function surfaceOf(target: StyleTarget, rules: readonly StyleRule[]): StyledSurfaceKind {
  if (target.rung === "surface") return target.kind;
  const rule = rules.find((entry) => entry.id === target.ruleId);
  switch (rule?.scope.kind) {
    case "type":
      return "card";
    case "shell":
      // A shell region is painted on the shell, which resolves the same roles a board does.
      return "board";
    case "kind":
      return (rule.scope.id as StyledSurfaceKind | undefined) ?? "card";
    default:
      return "card";
  }
}
