import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { MentionChipNodeView } from "../components/MentionChip";
import { type MentionSuggestionItem, mentionSuggestion, titleForCardId } from "./SuggestionList";

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Shared by the title and body editors so both open the same picker. */
  suggestion: Omit<SuggestionOptions<MentionSuggestionItem, MentionSuggestionItem>, "editor">;
}

/**
 * An inline atom pointing at a card. It stores only the target id: the title is
 * read live from the document, so renaming the target updates every mention and
 * a missing target renders as *Unavailable card* instead of failing.
 */
export const Mention = Node.create<MentionOptions>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: mentionSuggestion,
    };
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
    };
  },

  parseHTML() {
    return [{ tag: "span[data-card-id]" }];
  },

  // Export and clipboard copy keep the id and read as `@title` in plain text.
  renderHTML({ node, HTMLAttributes }) {
    const cardId = typeof node.attrs.cardId === "string" ? node.attrs.cardId : "";
    const title = titleForCardId(cardId) || cardId;
    return [
      "span",
      mergeAttributes({ "data-card-id": cardId }, this.options.HTMLAttributes, HTMLAttributes),
      `@${title}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChipNodeView);
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
