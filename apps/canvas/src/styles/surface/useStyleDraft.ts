import type { ResolvedSurfaceStyle, SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { isEmptyStyle, resolveSurfaceStyle } from "@suite/graph";
import { useMemo } from "react";
import { mergeSurfaceStyle } from "../../canvas/rules";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";

/** The three things a reader can paint: a card, a link, or a card's type. */
export type StyleSurfaceKind = "card" | "edge" | "type";

export interface StyleTarget {
  kind: StyleSurfaceKind;
  id: string;
}

export interface StyleDraft {
  /** The style as written on this target. */
  style: SurfaceStyle | undefined;
  /** What it paints once the type's style and the theme defaults are applied. */
  resolved: ResolvedSurfaceStyle;
  /** The type this card reads its default from, for the promote control. */
  typeId: string | null;
  /** The type's own style, so the panel can say what the card inherits. */
  typeStyle: SurfaceStyle | undefined;
  /** Writes one target's style; an empty record clears it. */
  patch: (next: SurfaceStyle) => void;
  reset: () => void;
  /** Copies this card's style onto its type. No card's own style is touched. */
  makeTypeDefault: () => void;
}

/**
 * One style draft, for one of three targets.
 *
 * Reading and writing are the only parts that differ between a card, a link and a
 * type, so they are the only parts that branch. There is no ladder to walk: a
 * card shows its type's style underneath its own, and everything else is the
 * theme.
 */
export function useStyleDraft(
  target: StyleTarget | null,
  injected: WorkspaceDocument | null = null,
): StyleDraft {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = injected ?? storeWorkspace;
  const snapshot = useWorkspaceSnapshot();

  const found = useMemo(() => {
    if (target === null) return { style: undefined, typeId: null, typeStyle: undefined };
    if (target.kind === "card") {
      const card = snapshot.cards.find((entry) => entry.id === target.id);
      const typeId = card?.primaryTypeId ?? null;
      const typeStyle = snapshot.types.find((entry) => entry.id === typeId)?.style;
      return { style: card?.style, typeId, typeStyle };
    }
    if (target.kind === "edge") {
      return {
        style: snapshot.edges.find((entry) => entry.id === target.id)?.style,
        typeId: null,
        typeStyle: undefined,
      };
    }
    return {
      style: snapshot.types.find((entry) => entry.id === target.id)?.style,
      typeId: target.id,
      typeStyle: undefined,
    };
  }, [snapshot, target]);

  const resolved = useMemo(
    () =>
      resolveSurfaceStyle(
        mergeSurfaceStyle(found.typeStyle ?? {}, found.style ?? {}),
        target?.kind === "edge" ? "link" : "card",
      ),
    [found, target],
  );

  const patch = (next: SurfaceStyle) => {
    if (target === null) return;
    // A key set to `undefined` means "back to the default", and the CRDT cannot
    // store an undefined value: dropping the key here is what makes the control
    // say what it means rather than writing an entry the store will lose.
    const declared = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined),
    ) as SurfaceStyle;
    const cleaned = isEmptyStyle(declared) ? null : declared;
    if (target.kind === "card") workspace.setCardStyle(target.id, cleaned);
    else if (target.kind === "edge") workspace.setEdgeStyle(target.id, cleaned);
    else workspace.updateType(target.id, { style: cleaned });
  };

  const reset = () => patch({});

  const makeTypeDefault = () => {
    if (target?.kind !== "card" || found.typeId === null) return;
    const own = found.style;
    if (own === undefined) return;
    // The type states the default and no card is stripped: a reader who liked
    // their exception keeps it, and the whole gesture is one undo step.
    workspace.updateType(found.typeId, { style: own });
  };

  return {
    style: found.style,
    resolved,
    typeId: found.typeId,
    typeStyle: found.typeStyle,
    patch,
    reset,
    makeTypeDefault,
  };
}
