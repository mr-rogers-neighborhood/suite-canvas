import type { SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { isEmptyStyle, resolveSurfaceStyle } from "@suite/graph";
import { useCallback } from "react";
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

  return { style, resolved: resolveSurfaceStyle(style, paintAs), patch, reset };
}
