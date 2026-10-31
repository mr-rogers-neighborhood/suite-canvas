import { PluginKey } from "@tiptap/pm/state";
import { type Editor, Extension } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { FORMAT_COMMANDS, type FormatCommand } from "../cards/formatCommands";
import { openImageUrlPrompt } from "./imageUrlPrompt";
import { promptYouTubeEmbed, uploadImageFile, uploadVideoFile } from "./mediaFileUpload";
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
    id: "image-upload",
    title: "Upload image",
    hint: "Upload a picture from your device",
    glyph: "IMG",
    keywords: ["image", "picture", "photo", "upload", "file"],
    run: (editor, range) => {
      consumeQuery(editor, range).run();
      uploadImageFile(editor);
    },
  },
  {
    id: "video-upload",
    title: "Upload video",
    hint: "Upload a video from your device",
    glyph: "VID",
    keywords: ["video", "movie", "clip", "mp4", "upload", "file"],
    run: (editor, range) => {
      consumeQuery(editor, range).run();
      uploadVideoFile(editor);
    },
  },
  {
    id: "youtube",
    title: "YouTube video",
    hint: "Embed a YouTube video",
    glyph: "YT",
    keywords: ["youtube", "video", "embed", "yt"],
    run: (editor, range) => {
      consumeQuery(editor, range).run();
      promptYouTubeEmbed(editor);
    },
  },
  {
    id: "image-url",
    title: "Image from URL",
    hint: "Embed a picture by link",
    glyph: "URL",
    keywords: ["image", "picture", "photo", "img", "url", "embed", "link"],
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
    id: "property",
    title: "Property",
    hint: "Show one of this card's fields",
    glyph: "\u25a4",
    // Fields live in the same picker as cards, so the block is one `@` away.
    keywords: ["property", "field", "value", "block", "metadata"],
    run: (editor, range) => consumeQuery(editor, range).insertContent("@").run(),
  },
];

/**
 * The `/` menu: every formatting command the toolbar and the bubble menu offer, plus the
 * insert-only rows. One table feeds all three surfaces, so a command cannot exist in one
 * and be missing from another.
 */
export const SLASH_ITEMS: SlashItem[] = [...FORMAT_COMMANDS.map(toSlashItem), ...INSERT_ITEMS];

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
