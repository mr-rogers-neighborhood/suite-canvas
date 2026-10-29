import type { ChainedCommands, Editor } from "@tiptap/react";

/**
 * The formatting controls for a card body, in one place.
 *
 * Two surfaces draw these and only the placement differs. On the canvas the toolbar rides
 * the selection as a bubble; in the inspector and the card panel it sits above the text as
 * a fixed row, because those columns are narrow enough that a floating row overflowed the
 * panel and hid its own buttons.
 *
 * The set is deliberately short. A card body is a note, not a document: bold, italic,
 * strikethrough, three heading levels and the two lists cover what people actually reach
 * for. H4–H6 remain in the schema and still respond to typed markdown (`#### `), so
 * nothing was taken away; what went away is six buttons nobody pressed that pushed the
 * useful ones off screen.
 */
export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bulletList: boolean;
  orderedList: boolean;
}

export interface EditorToolbarProps {
  editor: Editor | null;
  state: ToolbarState;
  /** Wraps onto a second row rather than leaving the panel. */
  wrap?: boolean;
  className?: string;
}

function buttonClass(active: boolean): string {
  return [
    "min-w-6 rounded px-1.5 py-0.5 text-[11px] leading-5",
    active
      ? "bg-[var(--ink)] text-[var(--surface)]"
      : "text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10",
  ].join(" ");
}

export function EditorToolbar({ editor, state, wrap = true, className }: EditorToolbarProps) {
  const run = (command: (chain: ChainedCommands) => ChainedCommands) => {
    if (!editor) return;
    command(editor.chain().focus()).run();
  };

  return (
    <div
      data-testid="format-toolbar"
      role="toolbar"
      aria-label="Formatting"
      className={[
        "flex items-center gap-1 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-lg",
        wrap ? "max-w-full flex-wrap" : "",
        className ?? "",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={state.bold}
        onClick={() => run((chain) => chain.toggleBold())}
        className={`${buttonClass(state.bold)} font-semibold`}
      >
        B
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={state.italic}
        onClick={() => run((chain) => chain.toggleItalic())}
        className={`${buttonClass(state.italic)} italic`}
      >
        I
      </button>
      <button
        type="button"
        aria-label="Strikethrough"
        aria-pressed={state.strike}
        onClick={() => run((chain) => chain.toggleStrike())}
        className={`${buttonClass(state.strike)} line-through`}
      >
        S
      </button>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hairline)]" />
      {([1, 2, 3] as const).map((level) => {
        const active = level === 1 ? state.heading1 : level === 2 ? state.heading2 : state.heading3;
        return (
          <button
            key={level}
            type="button"
            // The visible "H1" has to be part of the name, or a screen reader user who
            // hears "Heading 1" cannot find the button by the letters on it.
            aria-label={`H${String(level)} heading`}
            aria-pressed={active}
            onClick={() => run((chain) => chain.toggleHeading({ level }))}
            className={buttonClass(active)}
          >
            {`H${String(level)}`}
          </button>
        );
      })}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hairline)]" />
      <button
        type="button"
        aria-label="Bulleted list"
        aria-pressed={state.bulletList}
        onClick={() => run((chain) => chain.toggleBulletList())}
        className={buttonClass(state.bulletList)}
      >
        {"\u2022"}
      </button>
      <button
        type="button"
        aria-label="1. numbered list"
        aria-pressed={state.orderedList}
        onClick={() => run((chain) => chain.toggleOrderedList())}
        className={buttonClass(state.orderedList)}
      >
        1.
      </button>
    </div>
  );
}
