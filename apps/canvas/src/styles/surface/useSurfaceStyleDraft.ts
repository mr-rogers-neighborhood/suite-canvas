import type { StyleRule, StyleRuleScope, SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { isEmptyStyle, resolveSurfaceStyle } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { matchingRules, type SurfaceSubject } from "../../canvas/rules";
import { type StyledSurfaceKind, type StyleTarget, surfaceOf } from "../../canvas/styleTargets";
import { styleProvenance } from "../../canvas/styleUtilities";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { useStyleRules } from "./useStyleRules";

export type { StyledSurfaceKind, StyleTarget } from "../../canvas/styleTargets";

export interface StyledSurface {
  kind: StyledSurfaceKind;
  id: string;
}

/** What a rule-scoped draft needs to create the rule on its first edit. */
export interface RuleDraftScope {
  scope: StyleRuleScope;
  name: string;
}

/**
 * One style draft for any target — a surface, or a named rule
 * (ADR-0051,
 * ADR-0071 amendment).
 *
 * The editor is the same either way, which is the point: a rule is not a different kind of paint, it is
 * the same paint stated further up the ladder. Reading and writing are the only parts that differ, so they
 * are the only parts that branch.
 */
export function useSurfaceStyleDraft(
  target: StyleTarget | null,
  /**
   * The document to write through. Defaults to the live one; a host that was handed its own (a test, a
   * published snapshot) passes it so the editor never writes to a different document than the panel reads.
   */
  injected: WorkspaceDocument | null = null,
  /**
   * For a rule target, the scope to create when this rule does not exist yet. Absent for a rule the caller
   * already has an id for, and ignored for a surface.
   */
  createAs: RuleDraftScope | null = null,
): {
  style: SurfaceStyle | undefined;
  resolved: ReturnType<typeof resolveSurfaceStyle>;
  /** What an "Inherit" would leave this target with, named for the reader. */
  inherited: (utilityId: string) => { label: string; value: unknown } | null;
  patch: (next: SurfaceStyle) => void;
  reset: () => void;
  /** The rule being edited, when the target is one. */
  rule: StyleRule | null;
  rules: StyleRule[];
} {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = injected ?? storeWorkspace;
  const snapshot = useWorkspaceSnapshot();
  const rules = useStyleRules(injected);

  const rule =
    target?.rung === "rule" ? (rules.find((entry) => entry.id === target.ruleId) ?? null) : null;

  const style = useMemo(() => {
    if (!target) return undefined;
    if (target.rung === "rule") return rule?.style;
    switch (target.kind) {
      case "card":
        return snapshot.cards.find((entry) => entry.id === target.id)?.style;
      case "section":
        return snapshot.sections.find((entry) => entry.id === target.id)?.style;
      case "board":
        return snapshot.boards.find((entry) => entry.id === target.id)?.style;
      case "edge":
        return snapshot.edges.find((entry) => entry.id === target.id)?.style;
    }
  }, [rule, snapshot, target]);

  const writeRule = useCallback(
    (next: SurfaceStyle) => {
      if (!target || target.rung !== "rule") return;
      // A rule that does not exist yet is created on its first *edit*, never on selection, so browsing the
      // scope picker leaves the document alone.
      const existing = rules.find((entry) => entry.id === target.ruleId);
      if (existing) {
        workspace.setStyleRules(
          rules.map((entry) => (entry.id === target.ruleId ? { ...entry, style: next } : entry)),
        );
        return;
      }
      if (!createAs) return;
      workspace.setStyleRules([
        ...rules,
        {
          id: target.ruleId,
          name: createAs.name,
          order: rules.reduce((highest, entry) => Math.max(highest, entry.order + 1), 0),
          scope: createAs.scope,
          style: next,
        },
      ]);
    },
    [createAs, rules, target, workspace],
  );

  const writeSurface = useCallback(
    (next: SurfaceStyle | null) => {
      if (!target || target.rung !== "surface") return;
      switch (target.kind) {
        case "card":
          workspace.setCardStyle(target.id, next);
          break;
        case "section":
          workspace.setSectionStyle(target.id, next);
          break;
        case "board":
          workspace.setBoardStyle(target.id, next);
          break;
        case "edge":
          workspace.setEdgeStyle(target.id, next);
          break;
      }
    },
    [target, workspace],
  );

  const patch = useCallback(
    (next: SurfaceStyle) => {
      if (!target) return;
      if (target.rung === "rule") {
        // A rule keeps its record even when it names nothing: clearing every control is a question, and
        // deleting is the list's own verb.
        writeRule(next);
        return;
      }
      // A surface record that says nothing is removed, so "reset" and "never set" are the same state and
      // the document stops carrying empty objects.
      writeSurface(isEmptyStyle(next) ? null : next);
    },
    [target, writeRule, writeSurface],
  );

  const reset = useCallback(() => {
    if (!target) return;
    if (target.rung === "rule") writeRule({});
    else writeSurface(null);
  }, [target, writeRule, writeSurface]);

  const paintAs = useMemo(() => {
    const kind = target ? surfaceOf(target, rules) : "card";
    return kind === "edge" ? "link" : kind;
  }, [rules, target]);

  /**
   * The rung an empty control falls back to, named.
   *
   * "Inherit" used to be a word with no object — a reader could not tell whether they were inheriting a
   * default, their type's rule or the workspace's. This walks the same ladder the painter walks and
   * reports the source, so the option can read "Inherit from Concept".
   *
   * A rule asks the narrower question: with this rule saying nothing, what would still apply? Its own rung
   * is therefore left out — a rule cannot be the reason it inherits.
   */
  const inherited = useCallback(
    (utilityId: string) => {
      if (!target) return null;
      const editing =
        target.rung === "rule" ? rules.find((entry) => entry.id === target.ruleId) : null;
      const subject: SurfaceSubject = {
        surface: paintAs,
        ...(target.rung === "surface" && target.kind === "card"
          ? { typeId: snapshot.cards.find((entry) => entry.id === target.id)?.primaryTypeId }
          : editing?.scope.kind === "type"
            ? { typeId: editing.scope.id }
            : {}),
      };
      const typeNames = new Map(snapshot.types.map((type) => [type.id, type.name]));
      const ladder = matchingRules(subject, rules)
        .filter((entry) => entry.id !== editing?.id)
        .map((entry) => ({
          style: entry.style,
          rung:
            entry.scope.kind === "type"
              ? ("type" as const)
              : entry.scope.kind === "global"
                ? ("global" as const)
                : ("kind" as const),
          label:
            entry.scope.kind === "type"
              ? (typeNames.get(entry.scope.id ?? "") ?? "this type")
              : entry.scope.kind === "global"
                ? "this workspace"
                : entry.scope.kind === "kind"
                  ? "cards like this"
                  : entry.name,
        }));
      const provenance = styleProvenance({ style: undefined, rules: ladder, surface: paintAs }).get(
        utilityId,
      );
      if (!provenance || provenance.from === "built-in") {
        return { label: "the default", value: provenance?.value };
      }
      return { label: provenance.label, value: provenance.value };
    },
    [paintAs, rules, snapshot, target],
  );

  return {
    style,
    resolved: resolveSurfaceStyle(style, paintAs),
    inherited,
    patch,
    reset,
    rule,
    rules,
  };
}
