import type { GraphEdge, LayoutPlan, LayoutPlanPlacement, Placement, Section } from "@suite/graph";
import { growSectionsToFit } from "./arrangeCommand";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./multiSelect";

/**
 * Mind-map mode, simplified (ADR-0049): one selected card, its subtree, one radial
 * arrangement.
 *
 * The record asks for a mind map and stays silent on custom pattern systems, so this is a
 * layout *command*, not a live constraint: it reads the current subtree, plans positions,
 * and hands the plan to `WorkspaceDocument.applyLayoutPlan`, which commits all of them in
 * one undoable batch. Nothing here reads Loro, and nothing here keeps a rule that would
 * fight the reader afterwards.
 *
 * The tree is what the links already say. A child is an outbound link to a card, plus the
 * mentions the references index derives from the card's body, so a mind map of a card the
 * reader has already written links out of needs no new record.
 */

/** Distance between two rings, in flow units. */
export const RADIAL_RING_GAP = 320;

/** Where the first child sits, in radians; 0 is due right of the root. */
export const RADIAL_START_ANGLE = -Math.PI / 2;

export interface RadialInput {
  boardId: string;
  rootCardId: string;
  /** Card id → the cards under it. Order is the order the arcs are drawn in. */
  children: ReadonlyMap<string, readonly string[]>;
  placements: readonly Placement[];
  sections?: readonly Section[] | undefined;
  startAngle?: number | undefined;
}

/** One placed node, before its size is known: depth and angle around the root. */
export interface RadialSlot {
  cardId: string;
  /** 0 is the root, which is not placed; its children start at 1. */
  depth: number;
  /** Radians clockwise from the start angle. */
  angle: number;
}

/**
 * Depth and angle for every card reachable from the root.
 *
 * Breadth first, so a card reachable by two paths sits at its shallowest depth under the
 * parent that was reached first. That is what makes the result stable for a cyclic or a
 * diamond-shaped graph: the first path wins, and no card is drawn twice.
 */
export function radialSlots(input: RadialInput): RadialSlot[] {
  const start = input.startAngle ?? RADIAL_START_ANGLE;
  const root = input.rootCardId;
  const depthOf = new Map<string, number>([[root, 0]]);
  const tree = new Map<string, string[]>();
  const queue: string[] = [root];

  while (queue.length > 0) {
    const parent = queue.shift();
    if (parent === undefined) break;
    const depth = depthOf.get(parent) ?? 0;
    const kept: string[] = [];
    for (const childId of input.children.get(parent) ?? []) {
      if (depthOf.has(childId)) continue;
      depthOf.set(childId, depth + 1);
      kept.push(childId);
      queue.push(childId);
    }
    tree.set(parent, kept);
  }

  // Weight is the number of slots a subtree needs, so a wide branch claims a wide arc.
  const weight = new Map<string, number>();
  for (const cardId of [...depthOf.keys()].reverse()) {
    const own = (tree.get(cardId) ?? []).reduce((sum, child) => sum + (weight.get(child) ?? 1), 1);
    weight.set(cardId, own);
  }

  const slots: RadialSlot[] = [];
  const assign = (cardId: string, from: number, to: number): void => {
    const kids = tree.get(cardId) ?? [];
    const total = kids.reduce((sum, child) => sum + (weight.get(child) ?? 1), 0);
    if (total === 0) return;
    let cursor = from;
    for (const child of kids) {
      const share = ((to - from) * (weight.get(child) ?? 1)) / total;
      const angle = cursor + share / 2;
      slots.push({ cardId: child, depth: depthOf.get(child) ?? 1, angle });
      assign(child, cursor, cursor + share);
      cursor += share;
    }
  };
  assign(root, start, start + Math.PI * 2);

  // Sorted by ring, then by angle: the plan reads outside-in and, for a given ring,
  // clockwise from the start angle.
  return slots.sort((left, right) => left.depth - right.depth || left.angle - right.angle);
}

/**
 * The plan that moves the subtree onto rings around the root.
 *
 * The root is the anchor and is never moved: the reader put it where they wanted it, and a
 * radial command that also jumps the card they selected would lose their place. Sections
 * grow to fit, as they do for align and distribute, because a section someone sized by
 * hand is theirs.
 */
export function planRadial(input: RadialInput): LayoutPlan | null {
  const rootPlacement = input.placements.find(
    (placement) => placement.boardId === input.boardId && placement.cardId === input.rootCardId,
  );
  if (!rootPlacement) return null;

  const slots = radialSlots(input);
  if (slots.length === 0) return null;

  const centre = {
    x: rootPlacement.x + (rootPlacement.width ?? DEFAULT_CARD_WIDTH) / 2,
    y: rootPlacement.y + (rootPlacement.height ?? DEFAULT_CARD_HEIGHT) / 2,
  };
  const placed = new Map(
    input.placements
      .filter((placement) => placement.boardId === input.boardId)
      .map((placement) => [placement.cardId, placement]),
  );

  const placements: LayoutPlanPlacement[] = [];
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const slot of slots) {
    const current = placed.get(slot.cardId);
    const width = current?.width ?? DEFAULT_CARD_WIDTH;
    const height = current?.height ?? DEFAULT_CARD_HEIGHT;
    const radius = slot.depth * RADIAL_RING_GAP;
    const x = centre.x + radius * Math.cos(slot.angle) - width / 2;
    const y = centre.y + radius * Math.sin(slot.angle) - height / 2;
    boxes.push({ x, y, width, height });
    if (current && current.x === x && current.y === y) continue;
    placements.push({ boardId: input.boardId, cardId: slot.cardId, x, y });
  }

  if (placements.length === 0) return null;

  const sections = growSectionsToFit(input.sections ?? [], [
    ...boxes,
    {
      x: rootPlacement.x,
      y: rootPlacement.y,
      width: rootPlacement.width ?? DEFAULT_CARD_WIDTH,
      height: rootPlacement.height ?? DEFAULT_CARD_HEIGHT,
    },
  ]);

  return {
    boards: [input.boardId],
    placements,
    ...(sections.length > 0 ? { sections } : {}),
  };
}

export interface ChildSource {
  boardId: string;
  edges: readonly GraphEdge[];
  /** `fromCardId` → mentioned ids, from the references index. */
  references?: Readonly<Record<string, readonly string[]>> | undefined;
}

/**
 * The children map the planner wants, read from the document as it stands.
 *
 * Cards only: a link to a board is a portal, not a branch. A bidirectional link counts in
 * both directions because that is what it means; the planner's breadth-first walk is what
 * keeps a mutual link from recursing.
 */
export function childrenFromLinks(source: ChildSource): Map<string, string[]> {
  const children = new Map<string, string[]>();
  const add = (parent: string, child: string) => {
    if (parent === child) return;
    const list = children.get(parent);
    if (!list) {
      children.set(parent, [child]);
      return;
    }
    if (!list.includes(child)) list.push(child);
  };

  for (const edge of source.edges) {
    if (edge.boardId !== source.boardId) continue;
    if ((edge.sourceKind ?? "card") === "card" && (edge.targetKind ?? "card") === "card") {
      add(edge.source, edge.target);
    }
    if (edge.bidirectional && (edge.sourceKind ?? "card") === "card") {
      if ((edge.targetKind ?? "card") === "card") add(edge.target, edge.source);
    }
  }
  for (const [parent, mentioned] of Object.entries(source.references ?? {})) {
    for (const child of mentioned) add(parent, child);
  }
  return children;
}
