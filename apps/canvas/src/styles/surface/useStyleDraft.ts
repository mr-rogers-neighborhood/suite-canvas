import type { ResolvedSurfaceStyle, SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { isEmptyStyle, resolveSurfaceStyle } from "@suite/graph";
import { useMemo } from "react";
import { mergeSurfaceStyle } from "../../canvas/rules";
import { mergeStylePatch } from "../../canvas/styleTargets";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";

/** The three things a reader can paint: a card, a link, or a card's type. */
export type StyleSurfaceKind = "card" | "edge" | "type";

export interface StyleTarget {
  kind: StyleSurfaceKind;
  id: string;
}

/**
 * What a set of targets agrees on, and where it does not.
 *
 * Keyed by the record's own keys, because that is the unit a control edits: a mixed
 * `sides` makes that row read Mixed, not the whole panel.
 */
export interface SharedStyle {
  /** The value every target agrees on. Absent for a key they disagree about. */
  style: SurfaceStyle;
  mixed: ReadonlySet<keyof SurfaceStyle>;
}

export interface StyleDraft {
  /** What the targets agree on, as written. `{}` when they disagree everywhere. */
  style: SurfaceStyle | undefined;
  /** What it paints once the type's style and the theme defaults are applied. */
  resolved: ResolvedSurfaceStyle;
  /** The type a card reads its default from, for the promote control. */
  typeId: string | null;
  /** The type's own style, so the panel can say what the card inherits. */
  typeStyle: SurfaceStyle | undefined;
  /** Writes the patch to every target; an empty record clears them. */
  patch: (next: SurfaceStyle) => void;
  reset: () => void;
  /** Copies this card's style onto its type. No card's own style is touched. */
  makeTypeDefault: () => void;
  /** The keys the targets disagree about. Empty for a single target. */
  mixed: ReadonlySet<keyof SurfaceStyle>;
  /** How many targets the draft edits. */
  count: number;
  /**
   * The kind of surface being edited, or `null` when the set mixes kinds: a card and a
   * link share no row, and offering one anyway is what the separate bulk bar did.
   */
  kind: StyleSurfaceKind | null;
}

/** One key of a style record, which is the unit a control edits. */
function styleValue(style: SurfaceStyle | undefined, key: keyof SurfaceStyle): unknown {
  return style?.[key];
}

/** Writes one key of a shared record, which is why it takes the record not a copy. */
function setStyleValue(shared: SurfaceStyle, key: keyof SurfaceStyle, value: unknown): void {
  (shared as Record<string, unknown>)[key] = value;
}

/** A stable string for a value, so two equal records compare equal in any key order. */
function valueKey(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((name) => `${name}:${valueKey(record[name])}`)
    .join(",")}}`;
}

/**
 * One style draft, for one target or for a whole selection.
 *
 * A selection is not a different kind of edit: it is the same record written to each of
 * its members, so the same controls read and write it. What a selection adds is the
 * question "do they agree", which is answered per key and rendered as Mixed by the one
 * control that owns the key.
 */
export function useStyleDraft(
  targets: readonly StyleTarget[] | null,
  injected: WorkspaceDocument | null = null,
): StyleDraft {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = injected ?? storeWorkspace;
  const snapshot = useWorkspaceSnapshot();

  const found = useMemo(() => {
    /**
     * One entry per target, in the order the reader selected them.
     *
     * Every target is kept even when the snapshot has not carried it yet — an injected
     * workspace in a test, or a type the panel just opened — because the write goes to
     * the id the caller named, and a missing record only means "no style yet".
     */
    type Found = { target: StyleTarget; style: SurfaceStyle | undefined; typeId: string | null };
    // Reads follow the writes: an injected document is read directly, because a caller
    // that handed one in is not the live surface (a story, a test, a second workspace).
    const read = (target: StyleTarget): Found => {
      if (target.kind === "card") {
        const card =
          injected === null
            ? snapshot.cards.find((entry) => entry.id === target.id)
            : injected.getCard(target.id);
        return { target, style: card?.style, typeId: card?.primaryTypeId ?? null };
      }
      if (target.kind === "edge") {
        const edge =
          injected === null
            ? snapshot.edges.find((entry) => entry.id === target.id)
            : injected.getEdge(target.id);
        return { target, style: edge?.style, typeId: null };
      }
      const type =
        injected === null
          ? snapshot.types.find((entry) => entry.id === target.id)
          : injected.getType(target.id);
      return { target, style: type?.style, typeId: target.id };
    };
    const list = (targets ?? []).map(read);

    const shared: SurfaceStyle = {};
    const mixed = new Set<keyof SurfaceStyle>();
    for (const key of new Set(list.flatMap((entry) => Object.keys(entry.style ?? {})))) {
      const typed = key as keyof SurfaceStyle;
      const first = valueKey(styleValue(list[0]?.style, typed));
      const agrees = list.every((entry) => valueKey(styleValue(entry.style, typed)) === first);
      if (agrees) setStyleValue(shared, typed, styleValue(list[0]?.style, typed));
      else mixed.add(typed);
    }

    const firstCard = list.find((entry) => entry.target.kind === "card");
    const typeId = firstCard?.typeId ?? null;
    // The kind comes from what the reader selected, not from what was found: a type
    // with no style of its own is still a type, and its editor still shows its rows.
    const asked = new Set((targets ?? []).map((target) => target.kind));
    return {
      list,
      shared,
      mixed,
      typeId,
      typeStyle:
        injected === null
          ? snapshot.types.find((entry) => entry.id === typeId)?.style
          : typeId === null
            ? undefined
            : injected.getType(typeId)?.style,
      kind: asked.size === 1 ? ([...(targets ?? [])][0]?.kind ?? null) : null,
    };
  }, [snapshot, targets, injected]);

  const resolved = useMemo(
    () =>
      resolveSurfaceStyle(
        mergeSurfaceStyle(found.typeStyle ?? {}, found.shared),
        found.kind === "edge" ? "link" : "card",
      ),
    [found],
  );

  /** Writes one record per target, in one undo step when there is more than one. */
  const writeEach = (styleFor: (style: SurfaceStyle | undefined) => SurfaceStyle | null) => {
    if (found.list.length === 0) return;
    const write = (): void => {
      for (const entry of found.list) {
        const cleaned = styleFor(entry.style);
        if (entry.target.kind === "card") workspace.setCardStyle(entry.target.id, cleaned);
        else if (entry.target.kind === "edge") workspace.setEdgeStyle(entry.target.id, cleaned);
        else workspace.updateType(entry.target.id, { style: cleaned });
      }
    };
    // One undo step for the whole selection: a reader who colours five cards expects one
    // press of undo to take all five back.
    if (found.list.length > 1) workspace.batch("style:set", write);
    else write();
  };

  const patch = (next: SurfaceStyle) =>
    writeEach((style) => {
      // A key set to `undefined` means "back to the default": the merge deletes it,
      // because the CRDT cannot store an undefined value and a control that says
      // Default has to leave the record saying nothing.
      const merged = mergeStylePatch(style, next);
      return merged === null || isEmptyStyle(merged) ? null : merged;
    });

  const reset = () => writeEach(() => null);

  const makeTypeDefault = () => {
    const only = found.list.length === 1 ? found.list[0] : undefined;
    if (only?.target.kind !== "card" || only.typeId === null || only.style === undefined) return;
    // The type states the default and no card is stripped: a reader who liked their
    // exception keeps it, and the whole gesture is one undo step.
    workspace.updateType(only.typeId, { style: only.style });
  };

  return {
    // An empty record and no record are the same state to a reader, and the panel says
    // so: "this card wears its type's style" is true of both.
    style: isEmptyStyle(found.shared) ? undefined : found.shared,
    resolved,
    typeId: found.typeId,
    typeStyle: found.typeStyle,
    patch,
    reset,
    makeTypeDefault,
    mixed: found.mixed,
    count: found.list.length,
    kind: found.kind,
  };
}
