import { describe, expect, it } from "vitest";
import { parseCanvas } from "./canvas.js";
import {
  boardNameForFolder,
  extensionOf,
  fileKind,
  folderOf,
  isVaultInternal,
  stemOf,
} from "./files.js";
import { VaultIndex } from "./lookup.js";
import { CANVAS_COLOUR_MAP, canvasColour, mappingTableMarkdown, VAULT_MAPPING } from "./mapping.js";

describe("fileKind", () => {
  it("tells a note, a canvas and an attachment apart", () => {
    expect(fileKind({ path: "a/b.md" })).toBe("note");
    expect(fileKind({ path: "a/b.canvas" })).toBe("canvas");
    expect(fileKind({ path: "a/pic.png" })).toBe("attachment");
    expect(fileKind({ path: "a/thing.bin" })).toBe("other");
  });

  it("reads a path's folder, name and extension", () => {
    expect(folderOf("a/b/c.md")).toBe("a/b");
    expect(folderOf("c.md")).toBe("");
    expect(stemOf("a/b/C.md")).toBe("C");
    expect(extensionOf("a/b/C.MD")).toBe(".md");
    expect(extensionOf("a/b/noext")).toBe("");
  });

  it("skips Obsidian's own settings folder", () => {
    expect(isVaultInternal(".obsidian/app.json")).toBe(true);
    expect(isVaultInternal("Notes/.obsidian/x")).toBe(true);
    expect(isVaultInternal("Notes/alpha.md")).toBe(false);
  });

  it("names a folder board by its whole path", () => {
    expect(boardNameForFolder("Projects/Notes")).toBe("Projects / Notes");
    expect(boardNameForFolder("")).toBe("");
  });
});

describe("VaultIndex", () => {
  const index = (): VaultIndex => {
    const lookup = new VaultIndex();
    lookup.add("Home.md", "card-home");
    lookup.add("Projects/Alpha.md", "card-alpha");
    lookup.add("Archive/Alpha.md", "card-alpha-archive");
    lookup.add("Projects/Notes/Deep note.md", "card-deep");
    return lookup;
  };

  it("resolves a name through the linking note's folder first", () => {
    expect(index().resolve("Alpha", "Projects").cardId).toBe("card-alpha");
    expect(index().resolve("Alpha", "Archive").cardId).toBe("card-alpha-archive");
  });

  it("resolves a full path", () => {
    expect(index().resolve("Projects/Alpha", "").cardId).toBe("card-alpha");
    expect(index().resolve("Projects/Alpha.md", "").cardId).toBe("card-alpha");
  });

  it("resolves a bare name that only one note carries", () => {
    expect(index().resolve("Deep note", "").cardId).toBe("card-deep");
    expect(index().resolve("Home", "Archive").cardId).toBe("card-home");
  });

  it("marks a name two notes share as ambiguous when the folder does not decide", () => {
    const resolved = new VaultIndex().resolve("Alpha", "");
    const lookup = index();
    const ambiguous = lookup.resolve("Alpha", "Elsewhere");
    expect(resolved.ambiguous).toBe(false);
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.cardId).not.toBeNull();
  });

  it("returns nothing for a target the vault does not have", () => {
    expect(index().resolve("Missing", "")).toEqual({ path: null, cardId: null, ambiguous: false });
    expect(index().resolve("", "")).toEqual({ path: null, cardId: null, ambiguous: false });
  });

  it("finds a note by a path suffix", () => {
    expect(index().resolve("Notes/Deep note", "").cardId).toBe("card-deep");
  });
});

describe("parseCanvas", () => {
  it("reads all four node types and both edges", () => {
    const result = parseCanvas(
      JSON.stringify({
        nodes: [
          { id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10, text: "hi" },
          { id: "n2", type: "file", x: 0, y: 0, width: 10, height: 10, file: "A.md" },
          { id: "n3", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://x.test" },
          { id: "n4", type: "group", x: 0, y: 0, width: 10, height: 10, label: "G" },
        ],
        edges: [
          { id: "e1", fromNode: "n1", toNode: "n2" },
          { id: "e2", fromNode: "n2", toNode: "n3", label: "then" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canvas.nodes).toHaveLength(4);
    expect(result.canvas.edges).toHaveLength(2);
  });

  it("defaults a missing node or edge list", () => {
    const result = parseCanvas("{}");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canvas.nodes).toEqual([]);
    expect(result.canvas.edges).toEqual([]);
  });

  it("names why a canvas cannot be read", () => {
    expect(parseCanvas("{ nope").ok).toBe(false);
    const wrong = parseCanvas(JSON.stringify({ nodes: [{ id: "n", type: "sticker" }] }));
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.reason).toContain("JSON Canvas 1.0");
  });
});

describe("the mapping table", () => {
  const sources = VAULT_MAPPING.map((row) => row.source).join(" ");

  it("has a row for every source concept the importer reads", () => {
    for (const concept of [
      "Folder",
      "Markdown note",
      "First `#` heading",
      "Frontmatter",
      "`tags:`",
      "`#tag`",
      "[[Note]]",
      "![[image.png]]",
      ".canvas",
      "Canvas `text` node",
      "Canvas `file` node",
      "Canvas `link` node",
      "Canvas `group` node",
      "Canvas edge",
      "colour",
    ]) {
      expect(sources).toContain(concept);
    }
  });

  it("renders as a Markdown table the how-to page can hold", () => {
    const table = mappingTableMarkdown();
    expect(table.split("\n")).toHaveLength(VAULT_MAPPING.length + 2);
    expect(table.startsWith("| Source | Target | What travels |")).toBe(true);
  });

  it("maps Obsidian's presets onto the palette the schema names", () => {
    expect(Object.keys(CANVAS_COLOUR_MAP)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(canvasColour("4")).toEqual({ section: "green", surface: "success" });
    expect(canvasColour("#ff0000")).toBeNull();
    expect(canvasColour(undefined)).toBeNull();
  });
});
