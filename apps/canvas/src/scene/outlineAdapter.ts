import { buildOutline, flattenOutline, type Scene } from "@suite/scene";
import type { SceneOutlineItem } from "./SceneOutline";

/**
 * Map the derived scene tree onto the outline rail's plain props. The rail is
 * the non-spatial twin of the canvas, so it uses the same keys and depths as
 * `buildOutline`; `collapsed` only hides rows in the rail, never in the scene.
 */
export function sceneOutlineItems(
  scene: Scene,
  collapsed: ReadonlySet<string> = new Set(),
): SceneOutlineItem[] {
  const portals = new Map(scene.portals.map((portal) => [portal.key, portal] as const));
  const cardCounts = new Map<string, number>();
  for (const card of scene.cards) {
    cardCounts.set(card.boardKey, (cardCounts.get(card.boardKey) ?? 0) + 1);
  }

  const items: SceneOutlineItem[] = [];
  let hiddenBelowDepth: number | null = null;
  for (const row of flattenOutline(buildOutline(scene))) {
    if (hiddenBelowDepth !== null) {
      if (row.depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = null;
    }

    const portal = row.kind === "portal" ? portals.get(row.key) : undefined;
    const hasChildren = row.children.length > 0;
    const expanded = hasChildren && !collapsed.has(row.key);

    let cardCount: number | undefined;
    if (row.kind === "board") cardCount = cardCounts.get(row.key) ?? 0;
    else if (portal?.childKey) cardCount = cardCounts.get(portal.childKey);

    const item: SceneOutlineItem = {
      id: row.key,
      label: row.label,
      kind: row.cycle ? "cycle" : row.kind,
      depth: row.depth,
      lod: row.lod,
      expanded,
      hasChildren,
      boardId: row.boardId,
      ...(row.cardId === null ? {} : { portalCardId: row.cardId }),
      ...(cardCount === undefined ? {} : { cardCount }),
      ...(row.cycle ? { cycle: true } : {}),
      ...(portal?.targetMissing ? { unavailable: true } : {}),
    };
    items.push(item);

    if (hasChildren && collapsed.has(row.key)) hiddenBelowDepth = row.depth;
  }
  return items;
}
