import { describe, expect, it } from "vitest";
import type { LinkResolver } from "./convert.js";
import { blocksToNodes } from "./convert.js";
import {
  collectEmbeds,
  collectLinkTargets,
  collectTags,
  parseInline,
  parseMarkdown,
  plainText,
} from "./markdown.js";

const noLinks: LinkResolver = { resolve: () => ({ cardId: null, ambiguous: false }) };

describe("parseInline", () => {
  it("reads emphasis, code and a link", () => {
    const tokens = parseInline("**bold** and `code` and [site](https://example.com)");
    expect(tokens).toContainEqual({ kind: "text", text: "bold", marks: ["bold"] });
    expect(tokens).toContainEqual({ kind: "text", text: "code", marks: ["code"] });
    expect(tokens).toContainEqual({ kind: "link", text: "site", href: "https://example.com" });
  });

  it("reads a wikilink, an alias and a heading target", () => {
    expect(parseInline("[[Alpha]]")).toEqual([{ kind: "wikilink", target: "Alpha" }]);
    expect(parseInline("[[Alpha|the note]]")).toEqual([
      { kind: "wikilink", target: "Alpha", alias: "the note" },
    ]);
    expect(parseInline("[[Home#Sections]]")).toEqual([
      { kind: "wikilink", target: "Home", heading: "Sections" },
    ]);
  });

  it("reads an embed apart from a wikilink", () => {
    expect(parseInline("![[diagram.png]]")).toEqual([{ kind: "embed", target: "diagram.png" }]);
  });

  it("reads a tag only where Obsidian would", () => {
    expect(parseInline("a #idea here")).toContainEqual({ kind: "tag", name: "idea" });
    expect(parseInline("#idea")).toEqual([{ kind: "tag", name: "idea" }]);
    expect(parseInline("issue#42")).toEqual([{ kind: "text", text: "issue#42", marks: [] }]);
    expect(parseInline("#123")).toEqual([{ kind: "text", text: "#123", marks: [] }]);
  });

  it("keeps a backslash escape as its character", () => {
    expect(parseInline("\\#notatag")).toEqual([{ kind: "text", text: "#notatag", marks: [] }]);
  });
});

describe("parseMarkdown", () => {
  it("takes an opening H1 as the title and drops it from the body", () => {
    const parsed = parseMarkdown("# Alpha\n\nBody text");
    expect(parsed.title).toBe("Alpha");
    expect(parsed.blocks).toHaveLength(1);
    const [first] = parsed.blocks;
    expect(first?.kind === "paragraph" ? plainText(first.inline) : "").toBe("Body text");
  });

  it("keeps a later H1 as a heading", () => {
    const parsed = parseMarkdown("Intro\n\n# Second");
    expect(parsed.title).toBeNull();
    expect(parsed.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading"]);
  });

  it("reads quotes, rules, lists and fenced code", () => {
    const parsed = parseMarkdown("> quoted\n\n---\n\n- one\n1. two\n\n```ts\nconst a = 1;\n```");
    expect(parsed.blocks.map((block) => block.kind)).toEqual([
      "quote",
      "rule",
      "list",
      "list",
      "code",
    ]);
    const code = parsed.blocks.at(-1);
    expect(code?.kind === "code" ? code.language : null).toBe("ts");
  });

  it("records list indentation as depth", () => {
    const parsed = parseMarkdown("- one\n  - nested");
    const depths = parsed.blocks.flatMap((block) => (block.kind === "list" ? [block.depth] : []));
    expect(depths).toEqual([0, 1]);
  });

  it("joins a wrapped paragraph into one block", () => {
    const parsed = parseMarkdown("one\ntwo");
    expect(parsed.blocks).toHaveLength(1);
  });

  it("collects tags, link targets and embeds", () => {
    const parsed = parseMarkdown("# T\n\n#idea and [[Alpha]] and ![[pic.png]]");
    expect(collectTags(parsed.blocks)).toEqual(["idea"]);
    expect(collectLinkTargets(parsed.blocks)).toEqual(["Alpha"]);
    expect(collectEmbeds(parsed.blocks)).toEqual(["pic.png"]);
  });
});

describe("blocksToNodes", () => {
  it("turns a resolved link into a mention and an unresolved one into text", () => {
    const parsed = parseMarkdown("See [[Alpha]] and [[Nope]].");
    const converted = blocksToNodes(parsed.blocks, {
      resolve: (target) =>
        target === "Alpha"
          ? { cardId: "card-1", ambiguous: false }
          : { cardId: null, ambiguous: false },
    });
    const content = converted.nodes[0]?.content ?? [];
    expect(content).toContainEqual({ type: "mention", attrs: { cardId: "card-1" } });
    expect(JSON.stringify(content)).toContain("[[Nope]]");
    expect(converted.resolved).toBe(1);
    expect(converted.unresolved).toEqual(["Nope"]);
  });

  it("keeps an alias as text after the mention", () => {
    const parsed = parseMarkdown("[[Alpha|the note]]");
    const converted = blocksToNodes(parsed.blocks, {
      resolve: () => ({ cardId: "card-1", ambiguous: false }),
    });
    expect(converted.nodes[0]?.content).toEqual([
      { type: "mention", attrs: { cardId: "card-1" } },
      { type: "text", text: " the note" },
    ]);
  });

  it("drops a tag token from the text but reports nothing as lost", () => {
    const parsed = parseMarkdown("text #idea");
    const converted = blocksToNodes(parsed.blocks, noLinks);
    expect(JSON.stringify(converted.nodes)).not.toContain("#idea");
    expect(JSON.stringify(converted.nodes)).toContain("text");
  });

  it("refuses a link address that is not http, https or mailto", () => {
    const parsed = parseMarkdown("[click](javascript:alert(1))");
    const converted = blocksToNodes(parsed.blocks, noLinks);
    expect(converted.refusedLinks).toEqual(["javascript:alert(1)"]);
    expect(JSON.stringify(converted.nodes)).toContain("click");
    expect(JSON.stringify(converted.nodes)).not.toContain("javascript:");
  });

  it("nests a deeper list inside the item above it", () => {
    const parsed = parseMarkdown("- one\n  - nested\n- two");
    const converted = blocksToNodes(parsed.blocks, noLinks);
    const list = converted.nodes[0];
    expect(list?.type).toBe("bulletList");
    const items = list?.content ?? [];
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items[0])).toContain("nested");
  });

  it("writes a code block with its language", () => {
    const parsed = parseMarkdown("```js\nconst x = 1;\n```");
    const converted = blocksToNodes(parsed.blocks, noLinks);
    expect(converted.nodes[0]).toEqual({
      type: "codeBlock",
      attrs: { language: "js" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });
});
