import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(filterSlashItems("h1").map((entry) => entry.id)).toEqual(["heading-1"]);
    expect(filterSlashItems("quo").map((entry) => entry.id)).toEqual(["quote"]);
    expect(filterSlashItems("HEADING").map((entry) => entry.id)).toEqual([
      "heading-1",
      "heading-2",
    ]);
  });

  it("should match one word against several blocks", () => {
    expect(filterSlashItems("list").map((entry) => entry.id)).toEqual([
      "bullet-list",
      "ordered-list",
    ]);
  });

  it("should return nothing when no block matches", () => {
    expect(filterSlashItems("zzz")).toEqual([]);
  });
});

describe("slash commands", () => {
  it("should turn the typed query into a heading and leave no `/h1` behind", () => {
    const current = createEditor("/h1");
    item("heading-1").run(current, { from: 1, to: 4 });

    expect(firstNode(current)?.type.name).toBe("heading");
    expect(firstNode(current)?.attrs.level).toBe(1);
    expect(current.state.doc.textContent).toBe("");
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
