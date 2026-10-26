import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { MentionChipNodeView } from "./MentionChip";
import { MentionGhost } from "./mentionGhost";
import {
  fieldNameForId,
  type MentionSuggestionItem,
  mentionSuggestion,
  titleForCardId,
} from "./SuggestionList";

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  /**
   * Card that owns this editor. Its fields join the `@` picker, where picking
   * one inserts a property block; an empty id leaves the picker to cards only.
   */
  cardId: string;
  /** Shared by the title and body editors so both open the same picker. */
  suggestion: Omit<SuggestionOptions<MentionSuggestionItem, MentionSuggestionItem>, "editor">;
}

/**
 * An inline atom pointing at a card, or at one field of it. It stores only the
 * target id (and the field id when there is one): the title, the field name and
 * the value are read live, so a rename or an edit shows up in every mention and
 * a missing target renders as *Unavailable card* instead of failing.
 */
export interface MentionStorage {
  /** Card that owns the editor; read by the shared picker config. */
  cardId: string;
}

export const Mention = Node.create<MentionOptions, MentionStorage>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      cardId: "",
      suggestion: mentionSuggestion,
    };
  },

  // The suggestion config is shared, so the owner is read from storage at
  // query time instead of being baked into the module-level picker.
  addStorage() {
    return { cardId: this.options.cardId };
  },

  addAttributes() {
    return {
      cardId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-card-id"),
        renderHTML: (attributes) =>
          typeof attributes.cardId === "string" && attributes.cardId.length > 0
            ? { "data-card-id": attributes.cardId }
            : {},
      },
      /**
       * A display template for this one mention. Absent means "use the field's",
       * so a chip only carries a value when the reader overrode it.
       */
      display: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-display"),
        renderHTML: (attributes) =>
          typeof attributes.display === "string" && attributes.display.length > 0
            ? { "data-display": attributes.display }
            : {},
      },
      /** Set when the mention points at one field: the `@card.field` form. */
      fieldId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-field-id"),
        renderHTML: (attributes) =>
          typeof attributes.fieldId === "string" && attributes.fieldId.length > 0
            ? { "data-field-id": attributes.fieldId }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-card-id]" }];
  },

  // Export and clipboard copy keep the ids and read as `@title` or
  // `@title.field` in plain text.
  renderHTML({ node, HTMLAttributes }) {
    const cardId = typeof node.attrs.cardId === "string" ? node.attrs.cardId : "";
    const fieldId = typeof node.attrs.fieldId === "string" ? node.attrs.fieldId : "";
    const title = titleForCardId(cardId) || cardId;
    const field = fieldId ? fieldNameForId(cardId, fieldId) : "";
    return [
      "span",
      mergeAttributes(
        { "data-card-id": cardId, "data-field-id": fieldId },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      field ? `@${title}.${field}` : `@${title}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChipNodeView);
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },

  // The shadow completion is part of the mention experience: it renders what
  // Enter would insert without touching the document.
  addExtensions() {
    return [MentionGhost];
  },
});
