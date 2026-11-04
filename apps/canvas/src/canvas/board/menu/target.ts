import { portalTargetId } from "../../../cards/portal";
import type { EntityKind } from "../../../entities/kind";
import { selectionSummary } from "../../interactions/multiSelect";
import type { BoardMenuContext } from "./types";

/**
 * What a press resolved to, and which entities one colour reaches.
 *
 * The verb table asks this rather than reading the selection itself: one answer for the pressed
 * kind, the ids a verb acts on, and the selection behind them grouped by the field a colour writes.
 * Kept apart from the table because the table is a catalogue and this is the rule that reads a
 * press, and because a verb that re-derived "what is selected" is how the menu and the panels came
 * to disagree.
 */

/** The selection, grouped by the kind whose field a colour writes. */
export interface SelectionGroups {
  cards: string[];
  edges: string[];
  sections: string[];
}

export interface MenuTarget {
  kind: EntityKind;
  /** What the menu acts on: one thing, or the whole selection a press landed in. */
  ids: readonly string[];
  /**
   * The whole selection, grouped by kind, when the press landed inside it.
   *
   * A colour reaches every entity in the selection, and each kind stores it in its own field, so
   * the row needs the ids by kind rather than one flat list. A press outside the selection groups
   * only what it landed on, which is the same rule `ids` already follows.
   */
  idsByKind: SelectionGroups;
  /** The pressed thing, when there is one. */
  anchor?: string | undefined;
  /** A section connector's section; card connectors name their card instead. */
  sectionId?: string | undefined;
}

/** What a right-click landed on, or null when it landed on nothing an entity owns. */
export function resolveMenuTarget(ctx: BoardMenuContext): MenuTarget | null {
  const menu = ctx.menu;
  if (menu.kind === "canvas") return { kind: "canvas", ids: [], idsByKind: NO_GROUPS };
  if (menu.kind === "section") {
    if (!menu.sectionId) return null;
    return {
      kind: "section",
      ids: [menu.sectionId],
      idsByKind: groupsFor(ctx, { kind: "section", id: menu.sectionId }),
    };
  }
  if (menu.kind === "edge") {
    if (!menu.edgeId) return null;
    return {
      kind: "edge",
      ids: [menu.edgeId],
      idsByKind: groupsFor(ctx, { kind: "edge", id: menu.edgeId }),
    };
  }
  if (menu.kind === "connector") {
    if (!menu.connectorId) return null;
    if (menu.sectionId) {
      return {
        kind: "connector",
        ids: [menu.connectorId],
        idsByKind: NO_GROUPS,
        anchor: menu.connectorId,
        sectionId: menu.sectionId,
      };
    }
    if (!menu.nodeId) return null;
    return {
      kind: "connector",
      ids: [menu.connectorId],
      idsByKind: NO_GROUPS,
      anchor: menu.nodeId,
    };
  }
  const nodeId = menu.nodeId;
  if (!nodeId) return null;
  const summary = selectionSummary(ctx.selectedNodeIds);
  const inSelection = summary.multiple && summary.ids.includes(nodeId);
  return {
    kind: portalTargetId(ctx.cardsById.get(nodeId)) ? "portal" : "card",
    ids: inSelection ? summary.ids : [nodeId],
    idsByKind: groupsFor(ctx, { kind: "card", id: nodeId }),
    anchor: nodeId,
  };
}

const NO_GROUPS: SelectionGroups = { cards: [], edges: [], sections: [] };

/**
 * The whole selection when the press landed inside it, otherwise only what it landed on — the
 * rule `ids` already follows, kept in one place so colour cannot drift from the other verbs.
 */
function groupsFor(
  ctx: BoardMenuContext,
  pressed: { kind: "card" | "section" | "edge"; id: string } | null,
): SelectionGroups {
  if (pressed === null) return NO_GROUPS;
  const selection: SelectionGroups = {
    cards: [...ctx.selectedNodeIds],
    edges: [...ctx.selectedEdgeIds],
    sections: [...ctx.selectedSectionIds],
  };
  const key: keyof SelectionGroups =
    pressed.kind === "card" ? "cards" : pressed.kind === "edge" ? "edges" : "sections";
  if (selection[key].includes(pressed.id)) return selection;
  const only: SelectionGroups = { cards: [], edges: [], sections: [] };
  only[key].push(pressed.id);
  return only;
}
