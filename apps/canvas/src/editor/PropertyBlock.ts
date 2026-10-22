import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { useCanvasStore } from "../store/useCanvasStore";
import { PropertyBlockNodeView } from "./PropertyBlockChip";

export interface PropertyBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Card whose properties the blocks in this editor read and write. */
  cardId: string;
  /** Opens the card panel for `cardId`, where read-only kinds are edited. */
  openPanel: (cardId: string) => void;
}

/**
 * Field name for the plain-text/HTML serialisation. A block stores only the id;
 * the label lives in the card's type, so it is looked up at export time.
 */
export function propertyBlockLabel(cardId: string, fieldId: string): string {
  if (!cardId || !fieldId) return "";
  const workspace = useCanvasStore.getState().workspace;
  const card = workspace.getCard(cardId);
  if (!card) return "";
  return workspace.viewCardFields(card).find((view) => view.field.id === fieldId)?.field.name ?? "";
}

/**
 * An inline view of one card property. It stores only `fieldId`: the value is
 * read from `card.properties` and written through `setProperty`/`clearProperty`,
 * so the panel and every block show the same number and deleting a block never
 * deletes the value.
 */
export const PropertyBlock = Node.create<PropertyBlockOptions>({
  name: "propertyBlock",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      cardId: "",
      openPanel: () => {},
    };
  },

  addAttributes() {
    return {
      fieldId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-field-id"),
        renderHTML: (attributes) =>
          typeof attributes.fieldId === "string" && attributes.fieldId.length > 0
            ? { "data-field-id": attributes.fieldId }
            : {},
      },
      /** A display template for this one block; absent means the field's. */
      display: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-display"),
        renderHTML: (attributes) =>
          typeof attributes.display === "string" && attributes.display.length > 0
            ? { "data-display": attributes.display }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-field-id]" }];
  },

  // Copy and export read as `Label`, not as an opaque id.
  renderHTML({ node, HTMLAttributes }) {
    const fieldId = typeof node.attrs.fieldId === "string" ? node.attrs.fieldId : "";
    const label = propertyBlockLabel(this.options.cardId, fieldId);
    return [
      "span",
      mergeAttributes({ "data-field-id": fieldId }, this.options.HTMLAttributes, HTMLAttributes),
      label || "Property",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PropertyBlockNodeView, {
      // The block owns its inputs: without this ProseMirror would read their
      // keystrokes, move the caret into the atom and commit on every key.
      stopEvent: () => true,
    });
  },
});
