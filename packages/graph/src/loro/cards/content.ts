import { type ContainerID, LoroMap } from "loro-crdt";
import {
  firstLine,
  loroAttributes,
  loroChildren,
  propertyBlockFieldId,
  propertyBlockFieldIds,
  textOf,
} from "../../records/containers.js";
import { isList, isMap, observeIn } from "../../records/values.js";
import { BODY_BLOCK_ORIGIN, PROPERTY_BLOCK_NODE_NAME, STRUCT_ORIGIN } from "../constants.js";
import type { DocContext } from "../context.js";
import type { CardContainers } from "../model.js";

/**
 * Owns a card's text containers: the title and body editors mount against these, and a
 * container is stable until the cards map changes.
 */

export function contentMethods(ctx: DocContext) {
  return {
    /** Existing body container, or null. Reads never create shared state. */
    peekContent(cardId: string): LoroMap | null {
      const value = ctx.content.get(cardId);
      return isMap(value) ? value : null;
    },

    /** Existing title container, or null. Reads never create shared state. */
    peekTitle(cardId: string): LoroMap | null {
      const value = ctx.titles.get(cardId);
      return isMap(value) ? value : null;
    },

    /** Creates the body container if it is missing. Only writers should call this. */
    getContent(cardId: string): LoroMap {
      const existing = ctx.api.cards.peekContent(cardId);
      if (existing) return existing;
      const created = ctx.content.ensureMergeableMap(cardId);
      ctx.commit(`${STRUCT_ORIGIN}create-content`);
      return created;
    },

    /** Creates the title container if it is missing. Only writers should call this. */
    getTitle(cardId: string): LoroMap {
      const existing = ctx.api.cards.peekTitle(cardId);
      if (existing) return existing;
      const created = ctx.titles.ensureMergeableMap(cardId);
      ctx.commit(`${STRUCT_ORIGIN}create-title`);
      return created;
    },

    /** Stable container ids for the editor bindings. */
    contentId(cardId: string): ContainerID | null {
      return ctx.api.cards.peekContent(cardId)?.id ?? null;
    },

    titleId(cardId: string): ContainerID | null {
      return ctx.api.cards.peekTitle(cardId)?.id ?? null;
    },

    /**
     * True when a title container exists for this id, even if it only holds a
     * reference stub. Inside a projection that means "referenced but not shared",
     * as opposed to `peekTitle` returning null for a card that is truly gone.
     */
    hasTitle(cardId: string): boolean {
      return ctx.api.cards.peekTitle(cardId) !== null;
    },

    /**
     * Both text container ids for a card, in one identity-stable object. Editors
     * need this to adopt containers created by a peer after they mounted.
     */
    cardContainers(cardId: string): CardContainers {
      const cached = ctx.containerCache.get(cardId);
      if (cached) return cached;
      const next: CardContainers = {
        contentId: ctx.api.cards.contentId(cardId),
        titleId: ctx.api.cards.titleId(cardId),
      };
      ctx.containerCache.set(cardId, next);
      return next;
    },

    /** Fires when either text container for one card appears or disappears. */
    observeContainers(cardId: string, listener: () => void): () => void {
      return observeIn(ctx.containerListeners, cardId, listener);
    },

    /** Fires when the card's title (or the body it falls back to) changes. */
    observeTitle(cardId: string, listener: () => void): () => void {
      return observeIn(ctx.titleListeners, cardId, listener);
    },

    /** Title text, falling back to the body's first line, then "Untitled". */
    displayTitle(cardId: string): string {
      const title = firstLine(textOf(ctx.api.cards.peekTitle(cardId)));
      if (title) return title;
      const body = firstLine(textOf(ctx.api.cards.peekContent(cardId)));
      return body || "Untitled";
    },

    /** Plain text of a card's body, for backlink snippets. Never indexed. */
    cardText(cardId: string): string {
      return textOf(ctx.api.cards.peekContent(cardId));
    },

    /**
     * Field ids that already have a property block in the body, in document
     * order. Drives the panel's Show/Remove toggle; never stored separately.
     */
    bodyPropertyBlocks(cardId: string): string[] {
      const content = ctx.api.cards.peekContent(cardId);
      return content ? propertyBlockFieldIds(content) : [];
    },

    /**
     * Appends a `propertyBlock` view to the end of the card's body, followed by
     * an empty paragraph so typing can continue. Idempotent per field, and a
     * no-op for a card or field that does not exist: the block is only a view,
     * so pointing it at a missing field would render nothing useful.
     */
    appendPropertyBlock(cardId: string, fieldId: string): boolean {
      const card = ctx.api.cards.getCard(cardId);
      if (!card) return false;
      if (!ctx.api.cards.fieldForCard(card, fieldId)) return false;
      if (ctx.api.cards.bodyPropertyBlocks(cardId).includes(fieldId)) return false;

      const content = ctx.api.cards.getContent(cardId);
      if (content.get("nodeName") == null) content.set("nodeName", "doc");
      const paragraph = ctx.api.cards.appendBodyNode(content, "paragraph");
      const block = ctx.api.cards.appendBodyNode(paragraph, PROPERTY_BLOCK_NODE_NAME);
      loroAttributes(block).set("fieldId", fieldId);
      ctx.api.cards.appendBodyNode(content, "paragraph");
      ctx.doc.commit({ origin: BODY_BLOCK_ORIGIN });
      return true;
    },

    /**
     * Drops the block for one field and the paragraph that held it, since the
     * block was that paragraph's whole content. The property value itself is
     * untouched: deleting a view never deletes the value. Idempotent.
     */
    removePropertyBlock(cardId: string, fieldId: string): boolean {
      const content = ctx.api.cards.peekContent(cardId);
      if (!content) return false;
      const blocks = content.get("children");
      if (!isList(blocks)) return false;

      const blockNodes = blocks.toArray();
      let removed = false;
      for (let index = blockNodes.length - 1; index >= 0; index -= 1) {
        const paragraph = blockNodes[index];
        if (!isMap(paragraph)) continue;
        const inline = paragraph.get("children");
        if (!isList(inline)) continue;

        const inlineNodes = inline.toArray();
        let removedHere = false;
        for (let position = inlineNodes.length - 1; position >= 0; position -= 1) {
          const node = inlineNodes[position];
          if (!isMap(node) || node.get("nodeName") !== PROPERTY_BLOCK_NODE_NAME) continue;
          if (propertyBlockFieldId(node) !== fieldId) continue;
          inline.delete(position, 1);
          removedHere = true;
          removed = true;
        }
        if (removedHere && inline.length === 0) blocks.delete(index, 1);
      }
      if (!removed) return false;
      // A body must keep one block so the ProseMirror document stays valid.
      if (blocks.length === 0) ctx.api.cards.appendBodyNode(content, "paragraph");
      ctx.doc.commit({ origin: BODY_BLOCK_ORIGIN });
      return true;
    },

    /** Appends one `loro-prosemirror` node (and its containers) to a parent. */
    appendBodyNode(parent: LoroMap, nodeName: string): LoroMap {
      const children = loroChildren(parent);
      const node = children.insertContainer(children.length, new LoroMap());
      node.set("nodeName", nodeName);
      loroAttributes(node);
      loroChildren(node);
      return node;
    },
  };
}
