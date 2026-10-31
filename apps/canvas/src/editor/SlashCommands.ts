import { PluginKey } from "@tiptap/pm/state";
import { type Editor, Extension } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { type FormatCommand, type FormatMenu, formatMenus } from "../cards/formatCommands";
import { openMediaPicker } from "./mediaPicker";
import { createSlashRenderer } from "./SlashMenu";

export interface SlashRange {
  from: number;
  to: number;
}

/** One level of the heading row: body text, or one of the six headings. */
export interface SlashLevel {
  /** 0 is body text; 1 to 6 are the headings. */
  level: number;
  title: string;
  glyph: string;
  apply: (editor: Editor, range: SlashRange) => void;
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
  /**
   * Present on the one Heading row. The six levels and the way back to body text live here
   * rather than as seven rows, because a `/` menu that is three quarters headings pushes
   * media, mentions and properties below the fold of a 300px popover.
   */
  levels?: readonly SlashLevel[];
}

/** Removes the typed `/query` before the command touches the block. */
function consumeQuery(editor: Editor, range: SlashRange) {
  return editor.chain().focus().deleteRange(range);
}

/** A formatting command, as a row of the `/` menu. */
function toSlashItem(command: FormatCommand): SlashItem {
  return {
    id: command.id,
    title: command.title,
    hint: command.hint,
    glyph: command.glyph,
    keywords: command.keywords,
    run: (editor, range) => {
      const chain = consumeQuery(editor, range);
      (command.slashRun ?? command.run)(chain).run();
    },
  };
}

/**
 * The rows that only insert. No toolbar draws these: it changes the look of what is
 * selected, and a picture, a mention or a property block puts something new in.
 *
 * The tour step block is not here. Tours are paused, so the row advertised a feature that
 * led nowhere; the node, the schema entry and `presentTour` stay, and the block can be
 * brought back by inserting it directly.
 */
const INSERT_ITEMS: SlashItem[] = [
  {
    id: "media",
    title: "Media",
    hint: "Picture, video or embed",
    glyph: "M",
    // One row, one idea. Which kind of media is the dialog's question, so the
    // menu does not ask it four times in a row.
    keywords: [
      "media",
      "image",
      "img",
      "picture",
      "photo",
      "video",
      "movie",
      "clip",
      "mp4",
      "youtube",
      "yt",
      "embed",
      "upload",
      "file",
      "url",
      "link",
    ],
    run: (editor, range) => {
      consumeQuery(editor, range).run();
      openMediaPicker(editor);
    },
  },
  {
    id: "embed",
    title: "Embed",
    hint: "Show another card inside this one",
    glyph: "\u25a3",
    keywords: ["embed", "card", "include", "transclude", "reference", "internal"],
    // A block, not a chip: the reader picks the card in place, then resizes the figure.
    run: (editor, range) => {
      consumeQuery(editor, range).insertContent({ type: "embed" }).run();
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
    id: "property",
    title: "Property",
    hint: "Show one of this card's fields",
    glyph: "\u25a4",
    // Fields live in the same picker as cards, so the block is one `@` away.
    keywords: ["property", "field", "value", "block", "metadata"],
    run: (editor, range) => consumeQuery(editor, range).insertContent("@").run(),
  },
];

/** The one Heading row, folding six commands and a paragraph into a level list. */
function headingItem(menu: Extract<FormatMenu, { kind: "heading" }>): SlashItem {
  const levels: SlashLevel[] = [menu.paragraph, ...menu.levels].map((command) => ({
    level: command.id === "paragraph" ? 0 : Number(command.id.slice("heading-".length)),
    title: command.title,
    glyph: command.glyph,
    apply: (editor, range) => {
      const chain = consumeQuery(editor, range);
      (command.slashRun ?? command.run)(chain).run();
    },
  }));
  return {
    id: "heading",
    title: menu.title,
    hint: menu.hint,
    glyph: menu.glyph,
    keywords: [
      ...menu.levels.flatMap((command) => command.keywords),
      "heading",
      "headings",
      "title",
      "subtitle",
      "text",
      "paragraph",
      "body",
      "plain",
    ],
    levels,
    // Enter on the row without a level named gives the level a reader means by "a heading".
    run: (editor, range) => levels.find((level) => level.level === 2)?.apply(editor, range),
  };
}

/**
 * The `/` menu: every formatting command the toolbar and the bubble menu offer, plus the
 * insert-only rows. One table feeds all three surfaces, so a command cannot exist in one
 * and be missing from another.
 *
 * Headings arrive as one row from `formatMenus`, which is the same view the toolbar draws,
 * so the two surfaces cannot disagree about how many levels there are.
 */
export const SLASH_ITEMS: SlashItem[] = [
  ...formatMenus().map((menu) =>
    menu.kind === "heading" ? headingItem(menu) : toSlashItem(menu.command),
  ),
  ...INSERT_ITEMS,
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
