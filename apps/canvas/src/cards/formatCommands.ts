import type { ChainedCommands, Editor } from "@tiptap/react";

/**
 * Every formatting command a card body can take, in one table.
 *
 * Three surfaces draw these and they used to disagree: the `/` menu offered six heading
 * levels, a quote, a code block and a divider; the toolbar offered three levels and no
 * quote; the bubble inherited the toolbar. A command that exists in one place and not the
 * other is a reader's question — "why can I make a quote with `/` but not with the
 * toolbar?" — so the table is the answer, and each surface is a renderer over it.
 *
 * Two sets, deliberately:
 *
 * - `FORMAT_COMMANDS` toggle the block or the mark the caret is already in. They are the
 *   same in all three surfaces, because a toggle is a toggle wherever it is drawn.
 * - `INSERT_COMMANDS` put *new content* in, and only the `/` menu offers them: a toolbar
 *   button that inserts a picture, a mention or a property block is a second way to do a
 *   thing that already has a gesture, not a formatting control.
 */
export type FormatGroup = "mark" | "heading" | "block";

export interface FormatCommand {
  id: string;
  /** The name in the `/` menu. Clean enough to sit in a list. */
  title: string;
  /** What the button shows. Short enough for a narrow toolbar row. */
  glyph: string;
  /** Second line in the `/` menu: what it does, not another name for it. */
  hint: string;
  /** Extra `/` query words, so `/h4` and `/heading` both find level four. */
  keywords: string[];
  group: FormatGroup;
  /** Extra classes for the glyph: an italic "I" has to lean. */
  glyphClass?: string;
  run: (chain: ChainedCommands) => ChainedCommands;
  /**
   * The `/` variant, where the command converts the block instead of toggling it: typing
   * `/h1` inside an H1 means "make this a heading", not "make this a paragraph".
   */
  slashRun?: (chain: ChainedCommands) => ChainedCommands;
  /** Whether the command applies where the caret is, for the pressed state. */
  active: (editor: Editor) => boolean;
}

/**
 * The button's accessible name. A screen reader user who hears "H1 heading" has to be able
 * to find the button by the letters on it, so the visible glyph is folded into the name.
 */
export function buttonName(command: FormatCommand): string {
  return command.title.includes(command.glyph)
    ? command.title
    : `${command.title} ${command.glyph}`;
}

export const FORMAT_COMMANDS: readonly FormatCommand[] = [
  {
    id: "bold",
    title: "Bold",
    glyph: "B",
    hint: "Strong text",
    keywords: ["bold", "strong", "b"],
    group: "mark",
    glyphClass: "font-semibold",
    run: (chain) => chain.toggleBold(),
    active: (editor) => editor.isActive("bold"),
  },
  {
    id: "italic",
    title: "Italic",
    glyph: "I",
    hint: "Emphasised text",
    keywords: ["italic", "emphasis", "i"],
    group: "mark",
    glyphClass: "italic",
    run: (chain) => chain.toggleItalic(),
    active: (editor) => editor.isActive("italic"),
  },
  {
    id: "strike",
    title: "Strikethrough",
    glyph: "S",
    hint: "Text that is no longer true",
    keywords: ["strike", "strikethrough", "s"],
    group: "mark",
    glyphClass: "line-through",
    run: (chain) => chain.toggleStrike(),
    active: (editor) => editor.isActive("strike"),
  },
  ...([1, 2, 3, 4, 5, 6] as const).map(
    (level): FormatCommand => ({
      id: `heading-${String(level)}`,
      title: `H${String(level)} heading`,
      glyph: `H${String(level)}`,
      hint:
        level === 1
          ? "Section title"
          : level === 2
            ? "Subsection title"
            : level === 3
              ? "Third level"
              : level === 4
                ? "Fourth level"
                : level === 5
                  ? "Fifth level"
                  : "Sixth level",
      keywords: [`h${String(level)}`, "heading", level <= 2 ? "title" : "subtitle"],
      group: "heading",
      run: (chain) => chain.toggleHeading({ level }),
      slashRun: (chain) => chain.setHeading({ level }),
      active: (editor) => editor.isActive("heading", { level }),
    }),
  ),
  {
    id: "bullet-list",
    title: "Bulleted list",
    glyph: "\u2022",
    hint: "Unordered list",
    keywords: ["ul", "bullet", "list", "unordered"],
    group: "block",
    run: (chain) => chain.toggleBulletList(),
    active: (editor) => editor.isActive("bulletList"),
  },
  {
    id: "ordered-list",
    title: "Numbered list",
    glyph: "1.",
    hint: "Ordered list",
    keywords: ["ol", "number", "numbered", "list", "ordered"],
    group: "block",
    run: (chain) => chain.toggleOrderedList(),
    active: (editor) => editor.isActive("orderedList"),
  },
  {
    id: "quote",
    title: "Quote",
    glyph: "\u201c",
    hint: "Blockquote",
    keywords: ["quote", "blockquote", "citation"],
    group: "block",
    run: (chain) => chain.toggleBlockquote(),
    active: (editor) => editor.isActive("blockquote"),
  },
  {
    id: "code-block",
    title: "Code block",
    glyph: "</>",
    hint: "Preformatted text",
    keywords: ["code", "codeblock", "pre", "snippet"],
    group: "block",
    run: (chain) => chain.toggleCodeBlock(),
    active: (editor) => editor.isActive("codeBlock"),
  },
  {
    id: "divider",
    title: "Divider",
    glyph: "\u2014",
    hint: "Horizontal rule",
    keywords: ["divider", "hr", "horizontal", "rule", "separator", "line"],
    group: "block",
    run: (chain) => chain.setHorizontalRule(),
    // A rule is not a place the caret can sit in, so it is never "pressed".
    active: () => false,
  },
];

/** The ids of every formatting command, in table order, for a renderer or a test. */
export const FORMAT_IDS: readonly string[] = FORMAT_COMMANDS.map((command) => command.id);

/** The pressed state of every command, as one object the toolbar reads. */
export function activeCommands(editor: Editor): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const command of FORMAT_COMMANDS) state[command.id] = command.active(editor);
  return state;
}
