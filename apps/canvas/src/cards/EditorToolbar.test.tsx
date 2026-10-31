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

  it("should draw every command in the shared table, with the headings collapsed", () => {
    renderToolbar();
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    // The six heading commands are one menu now, so the row is the non-heading commands plus
    // that control and the one insert control that earns a place here.
    const visible = FORMAT_COMMANDS.filter((command) => command.group !== "heading").map(
      buttonName,
    );
    expect(names).toEqual([
      ...visible.slice(0, 3),
      "Heading: Text",
      ...visible.slice(3),
      "Add media",
    ]);
  });

  it("should show the heading level the caret is in", () => {
    renderToolbar({ "heading-2": true });
    expect(screen.getByTestId("format-heading")).toHaveTextContent("H2");
    expect(screen.getByTestId("format-heading")).toHaveAttribute("aria-label", "Heading: H2");
  });

  it("should open a level menu and mark the current level", () => {
    renderToolbar({ "heading-3": true });
    fireEvent.click(screen.getByTestId("format-heading"));

    const menu = screen.getByRole("menu", { name: "Heading" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId("format-heading-heading-3")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("format-heading-heading-1")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("format-heading-paragraph")).toHaveAttribute("aria-checked", "false");
  });

  it("should close the level menu on Escape and give focus back to the trigger", () => {
    renderToolbar();
    fireEvent.click(screen.getByTestId("format-heading"));
    expect(screen.getByRole("menu", { name: "Heading" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu", { name: "Heading" }), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Heading" })).not.toBeInTheDocument();
  });

  it("should set the chosen level rather than toggling the one already on", () => {
    const recorded = renderToolbar({ "heading-2": true });
    fireEvent.click(screen.getByTestId("format-heading"));
    fireEvent.click(screen.getByTestId("format-heading-heading-2"));

    // Choosing H2 while in an H2 means "make this an H2"; Paragraph is how a reader leaves.
    expect(recorded).toContain("setHeading");
    expect(recorded).not.toContain("toggleHeading");
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
    const bold = FORMAT_COMMANDS[0] as FormatCommand;
    fireEvent.click(byName(bold));
    expect(recorded).toContain("toggleBold");
  });

  it("should run every command it draws, so none is a decorative glyph", () => {
    const recorded = renderToolbar();
    const buttons = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") !== "Add media")
      .filter((button) => button.getAttribute("aria-haspopup") !== "menu");
    const expected = FORMAT_COMMANDS.filter((command) => command.group !== "heading");
    expect(buttons).toHaveLength(expected.length);
    for (const button of buttons) fireEvent.click(button);
    // `focus` and `run` are the chain's own ends, recorded like any other link in it.
    const commands = recorded.filter((name) => name !== "focus" && name !== "run");
    expect(commands).toHaveLength(expected.length);
  });

  it("should run the paragraph command from the heading menu", () => {
    const recorded = renderToolbar({ "heading-2": true });
    fireEvent.click(screen.getByTestId("format-heading"));
    fireEvent.click(screen.getByTestId("format-heading-paragraph"));
    expect(recorded).toContain("setParagraph");
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
