import type { SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { isEmptyStyle, resolveSurfaceStyle } from "@suite/graph";
import { useCallback } from "react";
import { matchingRules, type SurfaceSubject } from "../../canvas/rules";
import { styleProvenance } from "../../canvas/styleUtilities";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";

/** The records that can carry a paint style. */
export type StyledSurfaceKind = "card" | "section" | "board" | "edge";

export interface StyledSurface {
  kind: StyledSurfaceKind;
  id: string;
}

/**
 * One style draft for any surface.
 *
 * Reads the stored record, hands back the resolved paint and writes a patch
 * through the typed document layer. It lives here rather than in a panel prop
 * because *every* surface needs it — a card, a section, a board and a link are
 * painted by the same record ([ADR-0051](../../docs/decisions/0051-one-style-vocabulary-over-edges.md)),
 * so the editor should not be re-plumbed per entity kind.
 */
export function useSurfaceStyleDraft(
  target: StyledSurface | null,
  /**
   * The document to write through. Defaults to the live one; a host that was
   * handed its own (a test, a published snapshot) passes it so the editor never
   * writes to a different document than the panel is reading.
   */
  injected: WorkspaceDocument | null = null,
): {
  style: SurfaceStyle | undefined;
  resolved: ReturnType<typeof resolveSurfaceStyle>;
  /** What an "Inherit" would leave this surface with, named for the reader. */
  inherited: (utilityId: string) => { label: string; value: unknown } | null;
  patch: (next: SurfaceStyle) => void;
  reset: () => void;
} {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = injected ?? storeWorkspace;
  const snapshot = useWorkspaceSnapshot();

  const style = (() => {
    if (!target) return undefined;
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
  })();

  const write = useCallback(
    (next: SurfaceStyle | null) => {
      if (!target) return;
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
      // A record that says nothing is removed, so "reset" and "never set" are the
      // same state and the document stops carrying empty objects.
      write(isEmptyStyle(next) ? null : next);
    },
    [write],
  );

  const reset = useCallback(() => write(null), [write]);

  const paintAs = target?.kind === "edge" ? "link" : (target?.kind ?? "card");

  /**
   * The rung an empty control would fall back to, named.
   *
   * "Inherit" used to be a word with no object — a reader could not tell whether they
   * were inheriting a default, their type's rule or the workspace's. This walks the same
   * ladder the painter walks (ADR-0071) and reports the source, so the option can read
   * "Inherit from Concept".
   */
  const inherited = useCallback(
    (utilityId: string) => {
      if (!target) return null;
      const subject: SurfaceSubject = {
        surface: paintAs,
        ...(target.kind === "card"
          ? {
              typeId: snapshot.cards.find((entry) => entry.id === target.id)?.primaryTypeId,
            }
          : {}),
      };
      const typeNames = new Map(snapshot.types.map((type) => [type.id, type.name]));
      const rules = matchingRules(subject, workspace.styleRules()).map((rule) => ({
        style: rule.style,
        rung:
          rule.scope.kind === "type"
            ? ("type" as const)
            : rule.scope.kind === "global"
              ? ("global" as const)
              : ("kind" as const),
        label:
          rule.scope.kind === "type"
            ? (typeNames.get(rule.scope.id ?? "") ?? "this type")
            : rule.scope.kind === "global"
              ? "this workspace"
              : rule.scope.kind === "kind"
                ? "cards like this"
                : rule.name,
      }));
      const provenance = styleProvenance({ style: undefined, rules, surface: paintAs }).get(
        utilityId,
      );
      if (!provenance || provenance.from === "built-in") {
        return { label: "the default", value: provenance?.value };
      }
      return { label: provenance.label, value: provenance.value };
    },
    [paintAs, snapshot, target, workspace],
  );

  return { style, resolved: resolveSurfaceStyle(style, paintAs), inherited, patch, reset };
}
