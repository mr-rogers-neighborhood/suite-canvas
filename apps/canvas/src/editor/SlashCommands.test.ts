import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { FORMAT_COMMANDS } from "../cards/formatCommands";
import {
  filterSlashItems,
  SLASH_ITEMS,
  SlashCommands,
  slashSuggestionPluginKey,
} from "./SlashCommands";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(content = ""): Editor {
  editor = new Editor({ extensions: [StarterKit, SlashCommands], content });
  return editor;
}

function item(id: string) {
  const found = SLASH_ITEMS.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing slash item: ${id}`);
  return found;
}

function firstNode(current: Editor) {
  return current.state.doc.firstChild;
}

describe("filterSlashItems", () => {
  it("should list every block for an empty query", () => {
    expect(filterSlashItems("").map((entry) => entry.id)).toEqual(SLASH_ITEMS.map((e) => e.id));
    expect(filterSlashItems("   ")).toHaveLength(SLASH_ITEMS.length);
  });

  it("should match keywords as well as titles", () => {
    expect(filterSlashItems("h1").map((entry) => entry.id)).toEqual(["heading"]);
    expect(filterSlashItems("h4").map((entry) => entry.id)).toEqual(["heading"]);
    expect(filterSlashItems("quo").map((entry) => entry.id)).toEqual(["quote"]);
    // Every level answers to "heading", which is how a reader who has not learned the
    // `/h4` shorthand still finds the block.
    expect(filterSlashItems("HEADING").map((entry) => entry.id)).toEqual(["heading"]);
  });

  it("should fold the six heading levels into one row that carries all of them", () => {
    const heading = item("heading");
    expect(heading.levels?.map((level) => level.level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(SLASH_ITEMS.some((entry) => entry.id.startsWith("heading-"))).toBe(false);
  });

  it("should match one word against several blocks", () => {
    expect(filterSlashItems("list").map((entry) => entry.id)).toEqual([
      "bullet-list",
      "ordered-list",
    ]);
  });

  it("should find the property block by field or metadata", () => {
    expect(filterSlashItems("property").map((entry) => entry.id)).toEqual(["property"]);
    expect(filterSlashItems("field").map((entry) => entry.id)).toEqual(["property"]);
    expect(filterSlashItems("metadata").map((entry) => entry.id)).toEqual(["property"]);
  });

  it("should return nothing when no block matches", () => {
    expect(filterSlashItems("zzz")).toEqual([]);
  });

  it("should offer every formatting command the toolbar draws", () => {
    const ids = filterSlashItems("").map((entry) => entry.id);
    const collapsed = new Set([
      "heading-1",
      "heading-2",
      "heading-3",
      "heading-4",
      "heading-5",
      "heading-6",
    ]);
    for (const command of FORMAT_COMMANDS) {
      // The heading commands are the one row the menu collapses, and that row is the tab's
      // stand-in for all six.
      if (collapsed.has(command.id)) continue;
      expect(ids).toContain(command.id);
    }
    expect(ids).toContain("heading");
  });

  it("should not offer the tour step while tours are paused", () => {
    expect(filterSlashItems("step")).toEqual([]);
    expect(filterSlashItems("tour")).toEqual([]);
    expect(SLASH_ITEMS.map((entry) => entry.id)).not.toContain("step");
  });
});

describe("slash commands", () => {
  it("should turn the typed query into a heading and leave no `/h1` behind", () => {
    const current = createEditor("/h1");
    const level = item("heading").levels?.find((entry) => entry.level === 1);
    level?.apply(current, { from: 1, to: 4 });

    expect(firstNode(current)?.type.name).toBe("heading");
    expect(firstNode(current)?.attrs.level).toBe(1);
    expect(current.state.doc.textContent).toBe("");
  });

  it("should return a heading to body text from the same row", () => {
    const current = createEditor("/h2");
    const heading = item("heading").levels?.find((entry) => entry.level === 2);
    heading?.apply(current, { from: 1, to: 4 });
    expect(firstNode(current)?.type.name).toBe("heading");

    const paragraph = item("heading").levels?.find((entry) => entry.level === 0);
    paragraph?.apply(current, { from: 1, to: 1 });
    expect(firstNode(current)?.type.name).toBe("paragraph");
  });

  it("should apply the level a plain `/heading` does not name as H2", () => {
    const current = createEditor("/heading");
    item("heading").run(current, { from: 1, to: 9 });

    expect(firstNode(current)?.type.name).toBe("heading");
    expect(firstNode(current)?.attrs.level).toBe(2);
    expect(current.state.doc.textContent).toBe("");
  });

  it("should apply a quotation and a divider from the menu too", () => {
    const cited = createEditor("/quo");
    item("quote").run(cited, { from: 1, to: 5 });
    expect(firstNode(cited)?.type.name).toBe("blockquote");

    const ruled = createEditor("/div");
    item("divider").run(ruled, { from: 1, to: 5 });
    expect(firstNode(ruled)?.type.name).toBe("horizontalRule");
  });

  it("should insert a divider", () => {
    const current = createEditor("/divider");
    item("divider").run(current, { from: 1, to: 9 });

    const names: string[] = [];
    current.state.doc.forEach((node) => {
      names.push(node.type.name);
    });
    expect(names).toContain("horizontalRule");
    expect(current.state.doc.textContent).toBe("");
  });

  it("should convert the block to a list and a quote", () => {
    const listed = createEditor("/ul");
    item("bullet-list").run(listed, { from: 1, to: 4 });
    expect(firstNode(listed)?.type.name).toBe("bulletList");
    expect(listed.state.doc.textContent).toBe("");

    const quoted = createEditor("/quote");
    item("quote").run(quoted, { from: 1, to: 7 });
    expect(firstNode(quoted)?.type.name).toBe("blockquote");
    expect(quoted.state.doc.textContent).toBe("");
  });

  it("should hand the mention item over to the `@` picker", () => {
    const current = createEditor("/men");
    item("mention").run(current, { from: 1, to: 5 });

    expect(current.state.doc.textContent).toBe("@");
  });

  it("should hand the property item over to the same picker", () => {
    const current = createEditor("/property");
    item("property").run(current, { from: 1, to: 10 });

    expect(current.state.doc.textContent).toBe("@");
  });
});

describe("slash suggestion", () => {
  it("should open on `/` and filter by the text after it", () => {
    const current = createEditor("");
    current.commands.insertContent("/h2");

    const state = slashSuggestionPluginKey.getState(current.state);
    expect(state?.active).toBe(true);
    expect(state?.query).toBe("h2");
    expect(state?.range).toEqual({ from: 1, to: 4 });
  });

  it("should not open in the middle of a word", () => {
    const current = createEditor("");
    current.commands.insertContent("a/b");

    expect(slashSuggestionPluginKey.getState(current.state)?.active).toBe(false);
  });
});
