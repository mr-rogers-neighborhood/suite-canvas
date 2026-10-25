import { PluginKey } from "@tiptap/pm/state";
import { type Editor, Extension } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { openImageUrlPrompt } from "./imageUrlPrompt";
import { createSlashRenderer } from "./SlashMenu";

export interface SlashRange {
  from: number;
  to: number;
}

/** One row of the `/` menu, with the command it applies to the current block. */
export interface SlashItem {
  id: string;
  title: string;
  /** Second line: what the row does, not another name for it. */
  hint: string;
  glyph: string;
  /** Extra query words, so `/h1` finds Heading 1. */
  keywords: string[];
  run: (editor: Editor, range: SlashRange) => void;
}

/** Removes the typed `/query` before the command touches the block. */
function consumeQuery(editor: Editor, range: SlashRange) {
  return editor.chain().focus().deleteRange(range);
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "heading-1",
    title: "Heading 1",
    hint: "Section title",
    glyph: "H1",
    keywords: ["h1", "heading", "title"],
    run: (editor, range) => consumeQuery(editor, range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    title: "Heading 2",
    hint: "Subsection title",
    glyph: "H2",
    keywords: ["h2", "heading", "subtitle"],
    run: (editor, range) => consumeQuery(editor, range).setHeading({ level: 2 }).run(),
  },
  {
    id: "bullet-list",
    title: "Bulleted list",
    hint: "Unordered list",
    glyph: "\u2022",
    keywords: ["ul", "bullet", "list", "unordered"],
    run: (editor, range) => consumeQuery(editor, range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    title: "Numbered list",
    hint: "Ordered list",
    glyph: "1.",
    keywords: ["ol", "number", "numbered", "list", "ordered"],
    run: (editor, range) => consumeQuery(editor, range).toggleOrderedList().run(),
  },
  {
    id: "quote",
    title: "Quote",
    hint: "Blockquote",
    glyph: "\u201c",
    keywords: ["quote", "blockquote", "citation"],
    run: (editor, range) => consumeQuery(editor, range).toggleBlockquote().run(),
  },
  {
    id: "code-block",
    title: "Code block",
    hint: "Preformatted text",
    glyph: "</>",
    keywords: ["code", "codeblock", "pre", "snippet"],
    run: (editor, range) => consumeQuery(editor, range).toggleCodeBlock().run(),
  },
  {
    id: "divider",
    title: "Divider",
    hint: "Horizontal rule",
    glyph: "\u2014",
    keywords: ["divider", "hr", "horizontal", "rule", "separator", "line"],
    run: (editor, range) => consumeQuery(editor, range).setHorizontalRule().run(),
  },
  {
    id: "image-url",
    title: "Image from URL",
    hint: "Embed a picture by link",
    glyph: "IMG",
    keywords: ["image", "picture", "photo", "img", "url", "embed"],
    // The block is the only thing the menu inserts; the address is one line
    // asked for inline, so no dialog and no second menu.
    run: (editor, range) => {
      consumeQuery(editor, range).run();
      openImageUrlPrompt(editor);
    },
  },
  {
    id: "mention",
    title: "Mention",
    hint: "Link a card",
    glyph: "@",
    // The literal `@` hands over to the mention picker, which owns insertion.
    keywords: ["mention", "@", "link", "card", "reference"],
    run: (editor, range) => consumeQuery(editor, range).insertContent("@").run(),
  },
  {
    id: "step",
    title: "Tour step",
    hint: "One stop of a tour, anchored to a target",
    glyph: "\u25b8",
    // "tutorial" too: an author looking for the step block is writing a tour.
    keywords: ["step", "tour", "tutorial", "walkthrough", "spotlight", "present"],
    run: (editor, range) => {
      // Inserted without a target: picking one is a click on the canvas, which
      // the block itself arms (ADR-0054 §3).
      consumeQuery(editor, range)
        .insertContent({
          type: "tourStep",
          attrs: { stepId: crypto.randomUUID(), targets: [], advance: "next" },
        })
        .run();
    },
  },
  {
    id: "property",
    title: "Property",
    hint: "Show one of this card's fields",
    glyph: "\u25a4",
    // Fields live in the same picker as cards, so the block is one `@` away.
    keywords: ["property", "field", "value", "block", "metadata"],
    run: (editor, range) => consumeQuery(editor, range).insertContent("@").run(),
  },
];

/** Title and keyword matches, in menu order; an empty query shows everything. */
export function filterSlashItems(query: string): SlashItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...SLASH_ITEMS];
  return SLASH_ITEMS.filter((item) =>
    [item.title, ...item.keywords].some((word) => word.toLocaleLowerCase().includes(needle)),
  );
}

/**
 * Separate from the mention suggestion's key: Tiptap allows several suggestion
 * plugins, but each needs its own key or they overwrite each other's state.
 */
export const slashSuggestionPluginKey = new PluginKey("slashSuggestion");

/**
 * The `/` insert menu. It only converts the current block (or inserts a
 * divider), so every command runs against the range the suggestion reports.
 */
export const SlashCommands = Extension.create({
  name: "slashCommands",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashSuggestionPluginKey,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        allow: ({ editor }) => editor.isEditable,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => createSlashRenderer(slashSuggestionPluginKey),
      }),
    ];
  },
});
