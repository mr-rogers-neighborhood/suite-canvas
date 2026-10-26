import type { StyleRule, StyleRuleScope, WorkspaceDocument } from "@suite/graph";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StyledSurfaceKind } from "../canvas/styleTargets";
import {
  KIND_LABELS,
  moveRule,
  SCOPE_ORDER,
  SHELL_REGION_LABELS,
  surfacesUnderRule,
  withoutRule,
} from "../canvas/styleTargets";
import { useCanvasStore } from "../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { StyleTab } from "./surface/StyleTab";
import { useStyleRules } from "./surface/useStyleRules";

export interface StylesDialogProps {
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  /** The document to read and write; defaults to the live one. */
  workspace?: WorkspaceDocument | null;
}

const RUNG_LABELS: Record<string, string> = {
  global: "Everywhere",
  type: "Types",
  kind: "Kinds",
  shell: "Shell regions",
};

/** The scope in the reader's words: "Concept", "Every card", "The app bar". */
function scopeDescription(scope: StyleRuleScope, typeNames: ReadonlyMap<string, string>): string {
  switch (scope.kind) {
    case "global":
      return "Every surface in this workspace";
    case "type":
      return typeNames.get(scope.id ?? "") ?? "A type that no longer exists";
    case "kind":
      return `Every ${KIND_LABELS[(scope.id as StyledSurfaceKind | undefined) ?? "card"]}`;
    case "shell":
      return `The ${SHELL_REGION_LABELS[scope.id ?? ""] ?? scope.id ?? "shell"}`;
  }
}

/** The surface kind a rule paints, so the editor can hide what that surface cannot have. */
function surfaceKindOf(scope: StyleRuleScope): StyledSurfaceKind {
  if (scope.kind === "kind") return (scope.id as StyledSurfaceKind | undefined) ?? "card";
  if (scope.kind === "shell") return "board";
  return "card";
}

/** What a rule sets, in as few words as fit a row. */
function summarise(rule: StyleRule): string {
  const fields = Object.entries(rule.style).filter(([, value]) => value !== undefined);
  if (fields.length === 0) return "Names nothing yet";
  return fields
    .map(([field, value]) => {
      if (field === "sides") return "edges";
      return typeof value === "object" ? `${field}: custom` : `${field}: ${String(value)}`;
    })
    .join(" \u00b7 ");
}

/**
 * The rule list ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md) amendment).
 *
 * "What rules exist?" was unanswerable: a reader could paint one card and had no way to see, edit or remove
 * what was painting the rest. This groups them the way the resolver walks them — everywhere, then types,
 * then kinds, then shell regions — and edits a rule with the *same* `StyleTab` the inspector uses, so there
 * is one set of controls rather than two that drift.
 */
export function StylesDialog({ open, canEdit, onClose, workspace = null }: StylesDialogProps) {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const doc = workspace ?? storeWorkspace;
  const snapshot = useWorkspaceSnapshot();
  const rules = useStyleRules(workspace);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const typeNames = new Map(snapshot.types.map((type) => [type.id, type.name]));
  const grouped = SCOPE_ORDER.map((kind) => ({
    kind,
    label: RUNG_LABELS[kind] ?? kind,
    rules: rules.filter((rule) => rule.scope.kind === kind),
  })).filter((group) => group.rules.length > 0 || group.kind === "global");

  // The selection follows the list: a deleted rule hands the editor to whatever is first now, rather than
  // leaving a pane naming a rule that no longer exists.
  const editing = rules.find((rule) => rule.id === editingId) ?? rules[0] ?? null;

  const remove = (rule: StyleRule) => {
    if (!canEdit) return;
    doc.setStyleRules(withoutRule(rules, rule.id));
    if (editingId === rule.id) setEditingId(null);
  };

  const move = (rule: StyleRule, direction: -1 | 1) => {
    if (!canEdit) return;
    doc.setStyleRules(moveRule(rules, rule.id, direction));
  };

  /** A first rule of a scope nobody has claimed, ready to be given values. */
  const addRule = (scope: StyleRuleScope, name: string) => {
    if (!canEdit) return;
    const id = `rule-${crypto.randomUUID()}`;
    doc.setStyleRules([
      ...rules,
      {
        id,
        name,
        order: rules.reduce((highest, rule) => Math.max(highest, rule.order + 1), 0),
        scope,
        style: {},
      },
    ]);
    setEditingId(id);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close styles"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Styles"
        data-testid="styles-dialog"
        className="relative flex h-[min(560px,calc(100vh-3rem))] w-[min(820px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] shadow-xl"
      >
        <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--hairline)] p-2">
          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Rules, in resolution order
          </p>

          {grouped.map((group) => (
            <section key={group.kind} className="mb-2" data-testid={`styles-group-${group.kind}`}>
              <h3 className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                {group.label}
              </h3>
              {group.rules.length === 0 ? (
                <p className="px-1 pb-1 text-[11px] text-[var(--ink-muted)]">None yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {group.rules.map((rule) => {
                    const active = editing?.id === rule.id;
                    return (
                      <li key={rule.id}>
                        <div
                          className="rounded-lg px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                          data-testid={`styles-rule-${rule.id}`}
                          data-active={active ? "true" : undefined}
                        >
                          <button
                            type="button"
                            className="block w-full text-left"
                            data-testid={`styles-select-${rule.id}`}
                            aria-current={active ? "true" : undefined}
                            onClick={() => setEditingId(rule.id)}
                          >
                            <span className="block text-[12px] text-[var(--ink)]">{rule.name}</span>
                            <span className="block text-[10px] text-[var(--ink-muted)]">
                              {scopeDescription(rule.scope, typeNames)} · {summarise(rule)}
                            </span>
                          </button>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="style-chip"
                              data-testid={`styles-up-${rule.id}`}
                              disabled={!canEdit}
                              onClick={() => move(rule, -1)}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              className="style-chip"
                              data-testid={`styles-down-${rule.id}`}
                              disabled={!canEdit}
                              onClick={() => move(rule, 1)}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              className="style-chip"
                              data-testid={`styles-delete-${rule.id}`}
                              title={`${surfacesUnderRule(rule, snapshot.cards)} surface(s) fall back to the next rung`}
                              disabled={!canEdit}
                              onClick={() => remove(rule)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}

          {canEdit ? (
            <div className="mt-auto space-y-1 border-t border-[var(--hairline)] pt-2">
              <button
                type="button"
                className="style-chip"
                data-testid="styles-add-global"
                onClick={() => addRule({ kind: "global" }, "Everywhere")}
              >
                New rule: everywhere
              </button>
              <button
                type="button"
                className="style-chip"
                data-testid="styles-add-kind"
                onClick={() => addRule({ kind: "kind", id: "card" }, "Every card")}
              >
                New rule: every card
              </button>
              {Object.keys(SHELL_REGION_LABELS).map((region) => (
                <button
                  key={region}
                  type="button"
                  className="style-chip"
                  data-testid={`styles-add-shell-${region}`}
                  onClick={() =>
                    addRule({ kind: "shell", id: region }, `Every ${SHELL_REGION_LABELS[region]}`)
                  }
                >
                  New rule: the {SHELL_REGION_LABELS[region]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-3">
          {editing ? (
            <>
              <header className="mb-3 border-b border-[var(--hairline)] pb-2">
                <h2 className="text-[13px] font-semibold text-[var(--ink)]">{editing.name}</h2>
                <p className="text-[11px] text-[var(--ink-muted)]">
                  {scopeDescription(editing.scope, typeNames)}
                  {" · "}
                  {surfacesUnderRule(editing, snapshot.cards)} surface(s)
                </p>
              </header>
              <StyleTab
                kind={surfaceKindOf(editing.scope)}
                id={editing.id}
                ruleId={editing.id}
                canEdit={canEdit}
                workspace={workspace}
              />
            </>
          ) : (
            <p className="text-[12px] text-[var(--ink-muted)]" data-testid="styles-empty">
              No rules yet. Paint a card, then use “Applies to” to say it should apply more widely.
            </p>
          )}
        </div>

        <button
          type="button"
          aria-label="Close styles"
          data-testid="styles-close"
          className="absolute top-2 right-2 h-6 w-6 rounded-md text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
