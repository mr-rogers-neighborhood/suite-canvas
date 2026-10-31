import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";
import { openMediaPicker } from "../editor/mediaPicker";
import { useEscapeLayer } from "../shell/escapeLayers";
import {
  activeHeading,
  buttonName,
  type FormatCommand,
  type FormatMenu,
  formatMenus,
} from "./formatCommands";

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

/** Separators follow the menu's groups, so adding a command does not need a layout edit. */
function withGroupBreaks(menus: readonly FormatMenu[]): (FormatMenu | null)[] {
  const laidOut: (FormatMenu | null)[] = [];
  let group = "";
  for (const menu of menus) {
    const next = menu.kind === "command" ? menu.command.group : "heading";
    if (group !== "" && next !== group) laidOut.push(null);
    group = next;
    laidOut.push(menu);
  }
  return laidOut;
}

/**
 * Where the heading menu sits: under its trigger, kept inside the window.
 *
 * Fixed coordinates rather than an absolutely positioned child, because both hosts clip: the
 * bubble menu is inside a transformed canvas layer, and the inspector's column is narrow
 * enough that a menu hanging off its edge would be cut in half.
 */
function menuPosition(trigger: HTMLElement | null): { left: number; top: number } {
  if (!trigger) return { left: 8, top: 8 };
  const rect = trigger.getBoundingClientRect();
  const width = 152;
  const estimated = 232;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + 4;
  const top =
    below + estimated > window.innerHeight ? Math.max(8, rect.top - estimated - 4) : below;
  return { left, top };
}

export function EditorToolbar({ editor, active, wrap = true, className }: EditorToolbarProps) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setHeadingOpen(false), []);
  useEscapeLayer(close, headingOpen);

  useEffect(() => {
    if (!headingOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      close();
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [headingOpen, close]);

  const run = (command: FormatCommand) => {
    if (!editor) return;
    // The menu sets the level rather than toggling it: choosing H2 while already in an H2
    // means "make this an H2", and Paragraph is how you leave. A toggle would turn the level
    // the reader just chose into body text.
    (command.slashRun ?? command.run)(editor.chain().focus()).run();
  };

  const level = activeHeading(active);

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
      {withGroupBreaks(formatMenus()).map((menu, index) => {
        if (!menu) {
          return (
            <span
              key={`break-${String(index)}`}
              className="mx-0.5 h-4 w-px shrink-0 bg-[var(--hairline)]"
            />
          );
        }
        if (menu.kind === "heading") {
          const label = level === 0 ? "Text" : `H${String(level)}`;
          return (
            <span key="heading" className="flex shrink-0 items-center">
              <button
                ref={trigger}
                type="button"
                data-testid="format-heading"
                aria-haspopup="menu"
                aria-expanded={headingOpen}
                aria-label={`Heading: ${label}`}
                aria-pressed={level > 0}
                title="Heading"
                className={`inline-flex items-center gap-0.5 ${buttonClass(level > 0)}`}
                onClick={() => {
                  setPosition(menuPosition(trigger.current));
                  setHeadingOpen((open) => !open);
                }}
              >
                {label}
                <span aria-hidden="true" className="text-[9px] leading-none opacity-70">
                  {"\u25be"}
                </span>
              </button>
              {headingOpen ? (
                <div
                  ref={(node) => {
                    // Focus the first row, so the menu's own keys work from the first frame.
                    if (node) focusFirstMenuItem(node);
                    menuRef.current = node;
                  }}
                  role="menu"
                  aria-label="Heading"
                  data-testid="format-heading-menu"
                  style={{ position: "fixed", left: position.left, top: position.top }}
                  className="z-50 w-[152px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      close();
                      trigger.current?.focus();
                      return;
                    }
                    menuKeyDown(event);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {[menu.paragraph, ...menu.levels].map((command) => {
                    const rowLevel = command.id === "paragraph" ? 0 : Number(command.id.slice(8));
                    const checked = rowLevel === level;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={checked}
                        data-testid={`format-heading-${command.id}`}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] ${
                          checked
                            ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
                            : "text-[var(--ink-muted)] hover:bg-[var(--segmented-bg)]"
                        }`}
                        onClick={() => {
                          run(command);
                          close();
                          trigger.current?.focus();
                        }}
                      >
                        <span aria-hidden="true" className="w-5 text-center opacity-70">
                          {command.glyph}
                        </span>
                        <span className="min-w-0 truncate">{command.title}</span>
                        {checked ? (
                          <span aria-hidden="true" className="ml-auto opacity-70">
                            {"\u2713"}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </span>
          );
        }
        const command = menu.command;
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
