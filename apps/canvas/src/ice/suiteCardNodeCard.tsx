/**
 * Lab-only renderer: mounts the REAL Suite `NodeCard` into each `suite.card`
 * overlay slot from a local LoroDoc. This is the feasibility harness; production
 * cards go through `createWorkspaceCardSlotRenderer` (`suiteCardWorkspace.tsx`),
 * which binds the live workspace document instead.
 *
 * What a real `NodeCard` needed (all satisfied here):
 * - a `Card` record, its primary `CardType`, and a `CardMeta` (empty is fine);
 * - a LoroDoc holding `content`/`titles` mergeable maps, whose ids are
 *   `contentId`/`titleId`, with the rich-text root marked `nodeName: "doc"`
 *   and paragraph children — the same shape `WorkspaceDocument` writes;
 * - `cursorStore`/`localUser` may be null for a read-only face; `boardId` is
 *   only used for presence and menus, both inert with `readOnly`;
 * - a React root per overlay slot, and the app's global CSS for the card.
 */

import type { Card, CardType } from "@suite/graph";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { createRoot } from "react-dom/client";
import { NodeCard } from "../components/NodeCard";
import type { SuiteCardInfo, SuiteCardSlotRenderer } from "./suiteCardOverlay";

const CARD_TYPE: CardType = {
  id: "note",
  name: "Card",
  glyph: "\u25a2",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

const CARD_META = { properties: [], tags: [] };

/**
 * The same rich-text shape the graph layer writes for a card (`nodeName:
 * paragraph` → inline `LoroText`), so the real Tiptap editors can render it.
 */
function seedRichText(container: LoroMap, text: string): void {
  if (container.get("nodeName") == null) container.set("nodeName", "doc");
  const children = container.ensureMergeableList("children");
  for (const line of text.split("\n")) {
    const paragraph = children.insertContainer(children.length, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    const content = inline.insertContainer(0, new LoroText());
    content.insert(0, line);
  }
}

export function createNodeCardSlotRenderer(): SuiteCardSlotRenderer {
  return {
    mount(content: HTMLElement, info: SuiteCardInfo): () => void {
      const root = createRoot(content);
      const doc = new LoroDoc();
      const key = `suite-card-${info.entity}`;
      const titleMap = doc.getMap("titles").ensureMergeableMap(key);
      const contentMap = doc.getMap("content").ensureMergeableMap(key);
      seedRichText(titleMap, info.title);
      seedRichText(contentMap, info.body);
      doc.commit({ origin: "text:body" });

      const card: Card = {
        id: key,
        createdAt: 0,
        updatedAt: 0,
        connectors: [],
        typeIds: [CARD_TYPE.id],
        primaryTypeId: CARD_TYPE.id,
        tags: [],
        properties: {},
      };

      root.render(
        <NodeCard
          card={card}
          type={CARD_TYPE}
          meta={CARD_META}
          cardDoc={doc}
          contentId={contentMap.id}
          titleId={titleMap.id}
          cursorStore={null}
          localUser={null}
          boardId="suite-card-lab"
          width={info.worldWidth}
          height={info.worldHeight}
          readOnly
          showConnectors={false}
        />,
      );

      return () => {
        root.unmount();
        // ProseMirror's Loro plugins tear down asynchronously; freeing the wasm
        // document in the same tick makes their final reads hit freed memory.
        window.setTimeout(() => doc.free(), 500);
      };
    },
  };
}
