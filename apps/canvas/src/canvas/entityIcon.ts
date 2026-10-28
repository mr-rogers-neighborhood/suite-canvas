import type { SurfaceStyle, WorkspaceDocument } from "@suite/graph";

/**
 * Where an entity's icon comes from, in one chain.
 *
 * `style.icon` wins because the style record is what a reader edits and what syncs like any other
 * paint; the record's own `icon` is next (a card and a section carry one); the type's icon is the
 * fallback a card inherits. A portal is a card, so it uses the same chain. One reader means the canvas,
 * the inspector and the library cannot disagree, and adding a kind is a case in this file rather than a
 * search for every place that draws a glyph.
 */
export interface IconSource {
  /** The paint record on the entity, when it has one. */
  style?: SurfaceStyle | undefined;
  /** The entity's own icon field, when the record has one. */
  own?: string | undefined;
  /** A card's "draw nothing", which beats its own icon and its type's. */
  hidden?: boolean | undefined;
  /** What the entity inherits: a card's type icon. */
  inherited?: string | undefined;
}

/** The icon to draw, or null when the entity draws a glyph instead. */
export function resolvedIcon(source: IconSource): string | null {
  // A style icon is an explicit choice, so it outranks even "hidden": a reader who picks an icon for a
  // card that had none meant to show it.
  if (source.style?.icon) return source.style.icon;
  if (source.hidden === true) return null;
  return source.own ?? source.inherited ?? null;
}

/** What an icon write addresses. A portal is a card, but named so callers read clearly. */
export interface IconTarget {
  kind: "card" | "portal" | "section";
  id: string;
}

/**
 * Write an entity's icon through the one writer per kind.
 *
 * The value lands in `style.icon` for all three: the inspector's picker, the appearance panel and any
 * future surface then edit the same field, and a type can still restyle every card that has not chosen
 * one. `null` clears the choice, so the entity returns to its own icon and then its type's.
 */
export function setEntityIcon(
  workspace: WorkspaceDocument,
  target: IconTarget,
  icon: string | null,
): void {
  if (target.kind === "section") {
    workspace.setSectionIcon(target.id, icon);
    return;
  }
  const style = workspace.getCard(target.id)?.style ?? {};
  const { icon: _previous, ...rest } = style;
  workspace.setCardStyle(target.id, icon === null ? rest : { ...rest, icon });
}

/** A card's icon, resolved from its paint, its own field and its type. */
export function cardIcon(
  card: {
    style?: SurfaceStyle | undefined;
    icon?: string | undefined;
    iconHidden?: boolean | undefined;
  },
  typeIcon: string | undefined,
): string | null {
  return resolvedIcon({
    style: card.style,
    own: card.icon,
    hidden: card.iconHidden,
    inherited: typeIcon,
  });
}

/**
 * A section's icon.
 *
 * A section's paint is a colour rather than a style record, so its icon is the field `setSectionIcon`
 * writes. It still goes through the same reader, so a future style record on a section needs no caller
 * change.
 */
export function sectionIcon(section: { icon?: string | undefined }): string | null {
  return resolvedIcon({ own: section.icon });
}
