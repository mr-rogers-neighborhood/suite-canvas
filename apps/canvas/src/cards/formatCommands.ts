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

/**
 * The way back to a paragraph.
 *
 * It is not in `FORMAT_COMMANDS`: a toolbar button for "remove the heading" and a `/` row for
 * it would be two more controls in a row that is already the longest thing in the bubble. The
 * heading menu offers it, because a menu of six levels with no exit is a menu you have to
 * guess your way out of.
 */
export const PARAGRAPH_COMMAND: FormatCommand = {
  id: "paragraph",
  title: "Paragraph",
  glyph: "\u00b6",
  hint: "Body text",
  keywords: ["paragraph", "body", "text", "plain", "p"],
  group: "heading",
  run: (chain) => chain.setParagraph(),
  active: (editor) => editor.isActive("paragraph"),
};

/** One row of a formatting menu: a plain command, or the collapsed heading control. */
export type FormatMenu =
  | { readonly kind: "command"; readonly command: FormatCommand }
  | {
      readonly kind: "heading";
      readonly id: "heading";
      readonly title: string;
      readonly hint: string;
      readonly glyph: string;
      /** Levels 1 to 6, in order. */
      readonly levels: readonly FormatCommand[];
      /** The way back to body text. */
      readonly paragraph: FormatCommand;
    };

export const HEADING_MENU: Extract<FormatMenu, { kind: "heading" }> = {
  kind: "heading",
  id: "heading",
  title: "Heading",
  hint: "Title, subtitle or body text",
  glyph: "H",
  levels: FORMAT_COMMANDS.filter((command) => command.id.startsWith("heading-")),
  paragraph: PARAGRAPH_COMMAND,
};

/**
 * The table as a menu: the six heading commands become one entry, everything else stands.
 *
 * The table stays the source — a command added to it appears in the menu without an edit
 * here — and this is only a view over it, which is why the heading entry carries the same
 * `FormatCommand` objects the toolbar used to draw as buttons.
 */
export function formatMenus(commands: readonly FormatCommand[] = FORMAT_COMMANDS): FormatMenu[] {
  const menus: FormatMenu[] = [];
  let headingAdded = false;
  for (const command of commands) {
    if (command.group === "heading" && command.id.startsWith("heading-")) {
      if (!headingAdded) menus.push(HEADING_MENU);
      headingAdded = true;
      continue;
    }
    menus.push({ kind: "command", command });
  }
  return menus;
}

/**
 * The heading level the caret is in, or 0 for body text.
 *
 * The toolbar and the menu both read the same `active` record, so this is the one place that
 * turns six booleans into the value the heading button displays.
 */
export function activeHeading(active: Readonly<Record<string, boolean>>): number {
  for (let level = 1; level <= 6; level += 1) {
    if (active[`heading-${String(level)}`] === true) return level;
  }
  return 0;
}

/** The pressed state of every command, as one object the toolbar reads. */
export function activeCommands(editor: Editor): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const command of FORMAT_COMMANDS) state[command.id] = command.active(editor);
  return state;
}
