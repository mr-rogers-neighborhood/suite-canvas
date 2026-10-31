import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMediaPicker } from "../editor/mediaPicker";
import { EditorToolbar } from "./EditorToolbar";
import { buttonName, FORMAT_COMMANDS, type FormatCommand } from "./formatCommands";

/**
 * The toolbar is one component in three places, and the reason is a bug: the floating row
 * was eleven buttons wide and the inspector is narrower than that, so its own controls sat
 * off the edge of the panel. It wraps now, and it draws `FORMAT_COMMANDS` — the same table
 * the `/` menu reads — so the two can no longer disagree about what a card body offers.
 */
function renderToolbar(active: Record<string, boolean> = {}) {
  // The chain proxy returns itself, so a command is recorded by name.
  const recorded: string[] = [];
  const spy = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === "chain") {
          return () => {
            const builder: object = new Proxy(
              {},
              {
                get: (_t, command: string) => () => {
                  recorded.push(command);
                  return builder;
                },
              },
            );
            return builder;
          };
        }
        return () => false;
      },
    },
  );
  render(
    <EditorToolbar
      // biome-ignore lint/suspicious/noExplicitAny: a stand-in for a Tiptap editor, not one
      editor={spy as any}
      active={active}
    />,
  );
  return recorded;
}

function byName(command: FormatCommand) {
  return screen.getByRole("button", { name: buttonName(command) });
}

describe("the formatting toolbar", () => {
  it("should be a labelled toolbar rather than a row of anonymous buttons", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("should draw every command in the shared table, in its order", () => {
    renderToolbar();
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    // The format table, then the one insert control that earns a place here.
    expect(names).toEqual([...FORMAT_COMMANDS.map(buttonName), "Add media"]);
  });

  it("should keep each visible glyph inside its accessible name", () => {
    renderToolbar();
    for (const command of FORMAT_COMMANDS) {
      expect(buttonName(command)).toContain(command.glyph);
    }
  });

  it("should say which formats are on, so the state is not only a colour", () => {
    renderToolbar({ bold: true });
    expect(byName(FORMAT_COMMANDS[0] as FormatCommand)).toHaveAttribute("aria-pressed", "true");
    expect(byName(FORMAT_COMMANDS[1] as FormatCommand)).toHaveAttribute("aria-pressed", "false");
  });

  it("should run the command the button names", () => {
    const recorded = renderToolbar();
    const heading2 = FORMAT_COMMANDS.find((command) => command.id === "heading-2");
    if (!heading2) throw new Error("heading-2 missing from the table");
    fireEvent.click(byName(heading2));
    expect(recorded).toContain("toggleHeading");
  });

  it("should run every command it draws, so none is a decorative glyph", () => {
    const recorded = renderToolbar();
    const buttons = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") !== "Add media");
    expect(buttons).toHaveLength(FORMAT_COMMANDS.length);
    for (const button of buttons) fireEvent.click(button);
    // `focus` and `run` are the chain's own ends, recorded like any other link in it.
    const commands = recorded.filter((name) => name !== "focus" && name !== "run");
    expect(commands).toHaveLength(FORMAT_COMMANDS.length);
  });

  it("should open the media picker instead of inserting blindly", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Add media" }));
    expect(useMediaPicker.getState().open).toBe(true);
    useMediaPicker.getState().closePicker();
  });

  it("should wrap rather than overflow the column it is in", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar").className).toContain("flex-wrap");
  });
});
