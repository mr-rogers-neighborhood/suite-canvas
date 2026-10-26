import type { SurfaceStyle } from "@suite/graph";
import { type ResolvedSurfaceStyle, resolveSurfaceStyle } from "@suite/graph";
import { matchingRules, mergeSurfaceStyle } from "./rules";

/**
 * The style utilities ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)).
 *
 * A *utility* is one editable property of a surface, named once and reachable from
 * several surfaces: the Style tab, the inspector's style rows, the library row menu and
 * the right-click menu all render the same descriptor instead of three implementations
 * that drift. The index answers the two questions a Control cannot answer on its own:
 *
 * 1. **Who may own this?** — which rungs can state a value for it.
 * 2. **What does removing it fall back to?** — the next rung *by name*, never an
 *    undefined value. Advanced Themer calls this "safe to disable"; here it is a
 *    property of the index rather than a promise in a document.
 *
 * It is an index, not a new system: `rules.ts` already resolves the rungs
 * (global → kind → type → shell, then the surface's own style), and this names what a
 * reader can reach and where an inherited value came from.
 */
export type StyleRung = "card" | "type" | "kind" | "global" | "built-in";

/** Reader preferences are device state, not document state, so they are not a rung. */
export type StyleUtilityScope = "surface" | "reader";

/** The kinds of control a utility needs. One vocabulary, four renderings. */
export type StyleControlKind = "role" | "enum" | "number" | "text" | "toggle";

export interface StyleUtility {
  /** Stable id: what a Control, a test and a menu entry all key on. */
  id: string;
  /** "Colour", "Ink", "Shape" — the label a reader sees. */
  label: string;
  /** One line explaining what it changes, shown as a hint rather than a tooltip. */
  hint: string;
  scope: StyleUtilityScope;
  control: StyleControlKind;
  /** The `SurfaceStyle` field it writes; `null` for a reader preference. */
  writes: keyof SurfaceStyle | null;
  /**
   * The rungs that may state it, narrowest first. The last entry is always
   * `built-in`: a utility that could resolve to nothing would be a broken promise.
   */
  rungs: readonly StyleRung[];
}

/**
 * Every utility in the first slice.
 *
 * The paint utilities are the fields `SurfaceStyle` already has — this adds no new
 * vocabulary, it names what exists so a control can be shared. The reader utilities are
 * the four knobs the appearance entry point offers, and they are deliberately *not*
 * document state: they change how this device draws, never what a collaborator sees.
 */
export const STYLE_UTILITIES: readonly StyleUtility[] = [
  {
    id: "colour",
    label: "Colour",
    hint: "The surface's fill. Roles only, so a theme can repaint it.",
    scope: "surface",
    control: "role",
    writes: "surface",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "ink",
    label: "Ink",
    hint: "The text and glyph colour on this surface.",
    scope: "surface",
    control: "role",
    writes: "ink",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "shape",
    label: "Shape",
    hint: "Paint only: a silhouette never moves an anchor.",
    scope: "surface",
    control: "enum",
    writes: "shape",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "radius",
    label: "Corners",
    hint: "Corner rounding, in pixels.",
    scope: "surface",
    control: "number",
    writes: "radius",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "opacity",
    label: "Opacity",
    hint: "How far the surface recedes; hovering restores it.",
    scope: "surface",
    control: "number",
    writes: "opacity",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "textScale",
    label: "Text size",
    hint: "Relative to the surface's own default.",
    scope: "surface",
    control: "number",
    writes: "textScale",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "icon",
    label: "Icon",
    hint: "A named value, never markup.",
    scope: "surface",
    control: "text",
    writes: "icon",
    rungs: ["card", "type", "kind", "global", "built-in"],
  },
  {
    id: "density",
    label: "Density",
    hint: "How much air a card's content gets. This device only.",
    scope: "reader",
    control: "enum",
    writes: null,
    rungs: ["built-in"],
  },
  {
    id: "canvasBackground",
    label: "Canvas background",
    hint: "Plain, or the dot grid. This device only.",
    scope: "reader",
    control: "enum",
    writes: null,
    rungs: ["built-in"],
  },
  {
    id: "motion",
    label: "Motion",
    hint: "Whether the camera and the tours animate. This device only.",
    scope: "reader",
    control: "toggle",
    writes: null,
    rungs: ["built-in"],
  },
];

/** One utility by id, for a Control that was handed an id from a menu. */
export function styleUtility(id: string): StyleUtility | null {
  return STYLE_UTILITIES.find((utility) => utility.id === id) ?? null;
}

/** Where a resolved value came from, in words a reader can act on. */
export interface StyleProvenance {
  /** The rung that supplied it. */
  from: StyleRung;
  /** A readable name for that rung: "Concept", "Cards", "This workspace", "Default". */
  label: string;
  /** The value in effect after inheritance. */
  value: unknown;
}

export interface ProvenanceInput {
  /** The surface's own style, if it has one. */
  style: SurfaceStyle | undefined;
  /** The rules that match this surface, as `matchingRules` returns them. */
  rules: ReadonlyArray<{ style: SurfaceStyle; label: string; rung: StyleRung }>;
  /** The built-in defaults for this kind of surface. */
  surface: Parameters<typeof resolveSurfaceStyle>[1];
}

/**
 * Which rung supplied each utility's value, and what that value is.
 *
 * The ladder is read in the same order the painter uses — the rules (least specific
 * first, so a later one wins) and then the surface's own style — but it reports the
 * *source* of each field instead of only the result, which is what lets a control say
 * "Inherit from type: Concept" rather than showing a value nobody can account for.
 */
export function styleProvenance(input: ProvenanceInput): Map<string, StyleProvenance> {
  const out = new Map<string, StyleProvenance>();
  const builtIn = resolveSurfaceStyle(undefined, input.surface);

  for (const utility of STYLE_UTILITIES) {
    if (utility.writes === null) continue;
    const key = utility.writes as keyof SurfaceStyle & keyof ResolvedSurfaceStyle;

    let value = builtIn[key] as unknown;
    let from: StyleRung = "built-in";
    let label = "Default";

    for (const rule of input.rules) {
      const declared = rule.style[key];
      if (declared !== undefined) {
        value = declared;
        from = rule.rung;
        label = rule.label;
      }
    }
    const own = input.style?.[key];
    if (own !== undefined) {
      value = own;
      from = "card";
      label = "This card";
    }

    out.set(utility.id, { from, label, value });
  }
  return out;
}

/**
 * The value a utility resolves to *without* the surface's own style — i.e. what an
 * **Inherit** means, shown to the reader before they clear their override.
 */
export function inheritedValue(input: ProvenanceInput, utilityId: string): StyleProvenance | null {
  const utility = styleUtility(utilityId);
  if (!utility || utility.writes === null) return null;
  const inherited = styleProvenance({ ...input, style: undefined });
  return inherited.get(utilityId) ?? null;
}

/**
 * The style a surface would have if `remove` were taken away from it — used by the
 * fallback test, and by a Control that previews "removing this changes it to…".
 */
export function withoutUtility(style: SurfaceStyle, utilityId: string): SurfaceStyle {
  const utility = styleUtility(utilityId);
  if (!utility || utility.writes === null) return style;
  const next: SurfaceStyle = { ...style };
  delete next[utility.writes];
  return next;
}

/**
 * Merge the matching rules and a surface's own style into the record a painter sees.
 * Thin wrapper so a control does not have to import `rules.ts` to answer "what is in
 * effect", and so the index stays the single door.
 */
export function declaredStyle(
  style: SurfaceStyle | undefined,
  rules: ReadonlyArray<{ style: SurfaceStyle }>,
): SurfaceStyle {
  let merged: SurfaceStyle = {};
  for (const rule of rules) merged = mergeSurfaceStyle(merged, rule.style);
  return style ? mergeSurfaceStyle(merged, style) : merged;
}

/** Re-exported so callers of the index have one import for the whole ladder. */
export { matchingRules };
