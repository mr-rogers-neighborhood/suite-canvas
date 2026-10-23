/**
 * Production slot renderer for the `suite.card` kind: mounts the real Suite card
 * shell over ICE's GPU object.
 *
 * The card UI is not re-implemented here. `SceneCardView` already is the product
 * face — the real `NodeCard`, its Tiptap title/body bound to the workspace's Loro
 * containers, its type glyph, its property/tag chips, its menu and inspector
 * wiring, and the app's global CSS. This module supplies only the two things the
 * overlay cannot: the React root per slot, and the canonical `Card`/`CardType`/
 * `CardMeta` resolved from the live workspace stores.
 *
 * Read-only: ICE owns pointer input on the desk (the overlay is
 * `pointer-events:none`), and the workspace surface beside it may be editing the
 * same card. `readOnly` on `SceneCardView` keeps the twin from offering a second
 * editor or a second menu; the renderer creates no document and writes nothing
 * on mount.
 *
 * The overlay is the one geometry source: it sizes each slot from `geometryOf()`
 * and scales it by the camera. This renderer only fills the box it is given.
 */

import type { Tag } from "@suite/graph";
import { ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { type CardMeta, cardMeta } from "../cards/cardMeta";
import { resolveCardType, typesById } from "../cards/cardTypes";
import { SceneCardView } from "../scene/SceneCardView";
import { useCard, useWorkspaceSnapshot } from "../store/workspaceStore";
import type { SuiteCardInfo, SuiteCardSlotRenderer } from "./suiteCardOverlay";

export interface SuiteCardWorkspaceViewProps {
  /** The workspace card this object stands for; "" renders nothing. */
  readonly cardId: string;
  /** The board the card is placed on; scopes the card's presence and menus. */
  readonly boardId: string;
  /** Box in world units, from the overlay's geometry. */
  readonly width?: number | null;
  readonly height?: number | null;
}

/**
 * The live card face for one overlay slot. Every input is the workspace's own:
 * the record from `useCard`, the type and tags from the snapshot, and the meta
 * chips from `cardMeta`. A card that is not in this workspace (deleted, or an id
 * the projection has not hydrated yet) renders nothing rather than a stub that
 * could drift from the document.
 */
export function SuiteCardWorkspaceView({
  cardId,
  boardId,
  width = null,
  height = null,
}: SuiteCardWorkspaceViewProps) {
  const card = useCard(cardId);
  const snapshot = useWorkspaceSnapshot();
  // One index per snapshot identity: a peer editing a card elsewhere leaves the
  // types and tags arrays identical, so these stay cheap.
  const types = useMemo(() => typesById(snapshot.types), [snapshot.types]);
  const tags = useMemo(
    () => new Map<string, Tag>(snapshot.tags.map((tag) => [tag.id, tag])),
    [snapshot.tags],
  );

  if (card === undefined) return null;

  const type = resolveCardType(types, card.primaryTypeId);
  const meta: CardMeta = cardMeta(card, types, tags);

  return (
    <SceneCardView
      card={card}
      type={type}
      meta={meta}
      boardId={boardId}
      width={width}
      height={height}
      readOnly
    />
  );
}

/**
 * The seam the kind calls (`setSuiteCardSlotRenderer`). Each slot gets its own
 * React root; the returned teardown is the overlay's LOD unmount, so a card
 * below the readable width holds no editor at all.
 */
export function createWorkspaceCardSlotRenderer(): SuiteCardSlotRenderer {
  return {
    mount(content: HTMLElement, info: SuiteCardInfo): (() => void) | undefined {
      // No card named: the lab's string-only face, or a projection that resolved
      // no id. There is nothing to bind, so mount no root at all.
      if (info.cardId.length === 0) return undefined;
      const root = createRoot(content);
      root.render(
        <ReactFlowProvider>
          <SuiteCardWorkspaceView
            cardId={info.cardId}
            boardId={info.boardId}
            width={info.worldWidth}
            height={info.worldHeight}
          />
        </ReactFlowProvider>,
      );
      return () => root.unmount();
    },
  };
}
