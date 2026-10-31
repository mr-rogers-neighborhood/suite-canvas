import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlashItem } from "./SlashCommands";
import { SlashMenu } from "./SlashMenu";

const heading: SlashItem = {
  id: "heading",
  title: "Heading",
  hint: "Title, subtitle or body text",
  glyph: "H",
  keywords: ["heading"],
  run: () => {},
  levels: [
    { level: 0, title: "Paragraph", glyph: "\u00b6", apply: () => {} },
    { level: 1, title: "H1 heading", glyph: "H1", apply: () => {} },
    { level: 2, title: "H2 heading", glyph: "H2", apply: () => {} },
  ],
};

const quote: SlashItem = {
  id: "quote",
  title: "Quote",
  hint: "Blockquote",
  glyph: "\u201c",
  keywords: ["quote"],
  run: () => {},
};

function menu(overrides: Partial<Parameters<typeof SlashMenu>[0]> = {}) {
  const onSelect = vi.fn();
  const onSelectLevel = vi.fn();
  render(
    <SlashMenu
      items={[heading, quote]}
      query=""
      activeIndex={0}
      rect={null}
      levelsOpen={false}
      levelIndex={0}
      onHover={() => {}}
      onSelect={onSelect}
      onHoverLevel={() => {}}
      onSelectLevel={onSelectLevel}
      {...overrides}
    />,
  );
  return { onSelect, onSelectLevel };
}

describe("the slash menu", () => {
  it("should show one Heading row rather than six levels", () => {
    menu();
    const rows = screen.getAllByTestId("slash-option");
    expect(rows.map((row) => row.getAttribute("data-command-id"))).toEqual(["heading", "quote"]);
    expect(screen.queryAllByTestId("slash-level")).toHaveLength(0);
  });

  it("should list the levels in place when the row is open, without nesting listboxes", () => {
    menu({ levelsOpen: true, levelIndex: 2 });
    const levels = screen.getAllByTestId("slash-level");
    expect(levels.map((row) => row.getAttribute("data-level"))).toEqual(["0", "1", "2"]);
    // One listbox, and the highlighted level is an option of it: a second list would have
    // no focus of its own, because the suggestion plugin keeps focus in the editor.
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(levels[2]?.getAttribute("aria-selected")).toBe("true");
    expect(levels[0]?.getAttribute("aria-selected")).toBe("false");
  });

  it("should report the level a click chooses", () => {
    const { onSelectLevel } = menu({ levelsOpen: true });
    fireEvent.click(screen.getAllByTestId("slash-level")[1] as HTMLElement);
    expect(onSelectLevel).toHaveBeenCalledWith(heading.levels?.[1]);
  });

  it("should keep the whole row clickable, because a menu row is how the levels are reached", () => {
    const { onSelect } = menu();
    fireEvent.click(screen.getAllByTestId("slash-option")[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(heading);
  });
});
