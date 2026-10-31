import type { Editor } from "@tiptap/react";
import { openMediaPicker } from "../editor/mediaPicker";
import { buttonName, FORMAT_COMMANDS, type FormatCommand } from "./formatCommands";

/**
 * The formatting controls for a card body, in one place.
 *
 * Three surfaces draw this set and only the placement differs. On the canvas the toolbar
 * rides the selection as a bubble; in the inspector and the card panel it sits above the
 * text as a fixed row, because those columns are narrow enough that a floating row
 * overflowed the panel and hid its own buttons; and the `/` menu renders the same commands
 * as a searchable list. The items come from `FORMAT_COMMANDS` so the three cannot drift:
 * the row used to offer three heading levels and no quote, while `/` offered six levels, a
 * quote and a divider.
 *
 * Insert-only commands are not here. A picture, a mention or a property block adds content
 * rather than changing the look of what is already selected, and `/` is where you go to add
 * something.
 */
export interface EditorToolbarProps {
  editor: Editor | null;
  /** Pressed state by command id, from `activeCommands`. */
  active: Record<string, boolean>;
  /** Wraps onto a second row rather than leaving the panel. */
  wrap?: boolean;
  className?: string;
}

function buttonClass(active: boolean): string {
  return [
    "min-w-6 shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-5",
    active
      ? "bg-[var(--ink)] text-[var(--surface)]"
      : "text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10",
  ].join(" ");
}

/** Separators follow the table's groups, so adding a command does not need a layout edit. */
function withGroupBreaks(commands: readonly FormatCommand[]): (FormatCommand | null)[] {
  const laidOut: (FormatCommand | null)[] = [];
  let group = "";
  for (const command of commands) {
    if (group !== "" && command.group !== group) laidOut.push(null);
    group = command.group;
    laidOut.push(command);
  }
  return laidOut;
}

export function EditorToolbar({ editor, active, wrap = true, className }: EditorToolbarProps) {
  const run = (command: FormatCommand) => {
    if (!editor) return;
    command.run(editor.chain().focus()).run();
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
      {withGroupBreaks(FORMAT_COMMANDS).map((command, index) => {
        if (!command) {
          return (
            <span
              key={`break-${String(index)}`}
              className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hairline)]"
            />
          );
        }
        const on = active[command.id] === true;
        return (
          <button
            key={command.id}
            type="button"
            // The visible glyph has to be part of the name, or a screen reader user who
            // hears "H1 heading" cannot find the button by the letters on it.
            aria-label={buttonName(command)}
            aria-pressed={on}
            onClick={() => run(command)}
            className={`${buttonClass(on)} ${command.glyphClass ?? ""}`}
          >
            {command.glyph}
          </button>
        );
      })}
      {/* The one insert-only control that earns a place here: it asks a question
          rather than adding something blindly, and the `/` menu alone would hide
          media from anyone who does not know the gesture. */}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hairline)]" />
      <button
        type="button"
        aria-label="Add media"
        onClick={() => {
          if (editor) openMediaPicker(editor);
        }}
        className={buttonClass(false)}
      >
        M
      </button>
    </div>
  );
}
