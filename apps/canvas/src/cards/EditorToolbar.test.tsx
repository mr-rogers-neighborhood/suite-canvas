import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorToolbar, type EditorToolbarProps } from "./EditorToolbar";

/**
 * The toolbar is one component in two places, and the reason is a bug: the floating row was
 * eleven buttons wide and the inspector is narrower than that, so its own controls sat off
 * the edge of the panel. It is now eight buttons, it wraps, and the narrow surfaces place it
 * in the column instead of over it.
 */
const IDLE = {
  bold: false,
  italic: false,
  strike: false,
  heading1: false,
  heading2: false,
  heading3: false,
  bulletList: false,
  orderedList: false,
};

function renderToolbar(overrides: Partial<EditorToolbarProps> = {}) {
  // The chain proxy returns itself, so a command is recorded by name.
  const recorded: string[] = [];
  const editor = { chain: () => undefined };
  const spy = new Proxy(editor, {
    get: (target, name) => {
      if (name !== "chain") return Reflect.get(target, name);
      return () => {
        const builder = new Proxy(
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
    },
  });
  render(
    <EditorToolbar
      // biome-ignore lint/suspicious/noExplicitAny: a stand-in for a Tiptap editor, not one
      editor={spy as any}
      state={{ ...IDLE, ...(overrides.state ?? {}) }}
    />,
  );
  return recorded;
}

describe("the formatting toolbar", () => {
  it("should be a labelled toolbar rather than a row of anonymous buttons", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("should offer the eight controls a card body needs and no others", () => {
    renderToolbar();
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Strikethrough",
      "H1 heading",
      "H2 heading",
      "H3 heading",
      "Bulleted list",
      "1. numbered list",
    ]);
  });

  it("should say which formats are on, so the state is not only a colour", () => {
    renderToolbar({ state: { ...IDLE, bold: true } });
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "false");
  });

  it("should run the command the button names", () => {
    const recorded = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "H2 heading" }));
    expect(recorded).toContain("toggleHeading");
  });

  it("should wrap rather than overflow the column it is in", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar").className).toContain("flex-wrap");
  });
});
