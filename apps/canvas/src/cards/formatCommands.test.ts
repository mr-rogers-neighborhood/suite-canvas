import { describe, expect, it } from "vitest";
import {
  activeHeading,
  buttonName,
  FORMAT_COMMANDS,
  type FormatCommand,
  formatMenus,
  HEADING_MENU,
  PARAGRAPH_COMMAND,
} from "./formatCommands";

function record(apply: (chain: never) => unknown): string[] {
  const calls: string[] = [];
  const chain: object = new Proxy(
    {},
    {
      get: (_target, name) => () => {
        calls.push(String(name));
        return chain;
      },
    },
  );
  apply(chain as never);
  return calls;
}

function command(id: string): FormatCommand {
  const found = FORMAT_COMMANDS.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing command: ${id}`);
  return found;
}

describe("the shared formatting table", () => {
  it("should name every command once, so a renderer can key on the id", () => {
    const ids = FORMAT_COMMANDS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should cover the six heading levels typed markdown can reach", () => {
    expect(FORMAT_COMMANDS.filter((entry) => entry.group === "heading")).toHaveLength(6);
  });

  it("should toggle where the toolbar toggles and set where the `/` menu converts", () => {
    expect(record((chain) => command("heading-2").run(chain))).toEqual(["toggleHeading"]);
    expect(
      record((chain) => (command("heading-2").slashRun ?? command("heading-2").run)(chain)),
    ).toEqual(["setHeading"]);
    // Everything else behaves the same in both places.
    expect(record((chain) => command("quote").run(chain))).toEqual(["toggleBlockquote"]);
    expect(command("quote").slashRun).toBeUndefined();
  });

  it("should give every command a `/` word that finds it", () => {
    for (const entry of FORMAT_COMMANDS) {
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(entry.keywords.some((word) => entry.title.toLowerCase().includes(word))).toBe(true);
    }
  });

  it("should fold the glyph into the button name for a screen reader", () => {
    // "B" is already a letter of "Bold", so naming it twice would read as a stutter.
    expect(buttonName(command("bold"))).toBe("Bold");
    expect(buttonName(command("heading-1"))).toBe("H1 heading");
    // A glyph that is not spelled out has to be added, or a reader who sees "1." has no
    // way to find the button by what is on it.
    expect(buttonName(command("ordered-list"))).toBe("Numbered list 1.");
  });

  it("should never mark a divider as pressed, because the caret cannot sit in one", () => {
    const editor = { isActive: () => true } as unknown as Parameters<FormatCommand["active"]>[0];
    expect(command("divider").active(editor)).toBe(false);
  });
});

describe("the formatting menu view", () => {
  it("should collapse the six heading commands into one entry in table order", () => {
    const menus = formatMenus();
    const headings = menus.filter((menu) => menu.kind === "heading");
    expect(headings).toHaveLength(1);

    // The heading entry sits where the first heading command sat, so the row's groups keep
    // their order: marks, then headings, then blocks.
    const order = menus.map((menu) => (menu.kind === "heading" ? menu.id : menu.command.id));
    expect(order).toEqual([
      "bold",
      "italic",
      "strike",
      "heading",
      "bullet-list",
      "ordered-list",
      "quote",
      "code-block",
      "divider",
    ]);
  });

  it("should carry every level and a way back to body text", () => {
    expect(HEADING_MENU.levels.map((command) => command.id)).toEqual([
      "heading-1",
      "heading-2",
      "heading-3",
      "heading-4",
      "heading-5",
      "heading-6",
    ]);
    expect(HEADING_MENU.paragraph).toBe(PARAGRAPH_COMMAND);
  });

  it("should keep the paragraph command out of the table, so it is not a seventh button", () => {
    expect(FORMAT_COMMANDS.some((command) => command.id === "paragraph")).toBe(false);
  });

  it("should report the heading level the caret is in", () => {
    expect(activeHeading({})).toBe(0);
    expect(activeHeading({ "heading-1": false, "heading-4": true })).toBe(4);
    // Body text is the absence of a heading, not a heading of level zero.
    expect(activeHeading({ "heading-1": false })).toBe(0);
  });
});
