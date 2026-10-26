import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mention } from "./Mention";

// The chip and the picker need a live workspace; serialisation does not.
vi.mock("./MentionChip", () => ({ MentionChipNodeView: () => null }));
vi.mock("./SuggestionList", () => ({
  mentionSuggestion: {},
  titleForCardId: (cardId: string) => (cardId === "card-1" ? "Design doc" : ""),
}));

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mentionAttrs(current: Editor): unknown[] {
  const ids: unknown[] = [];
  current.state.doc.descendants((node) => {
    if (node.type.name === "mention") ids.push(node.attrs.cardId);
    return true;
  });
  return ids;
}

describe("Mention node", () => {
  it("should serialise the card id into HTML and parse it back", () => {
    editor = new Editor({ extensions: [StarterKit, Mention], content: "" });

    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "mention", attrs: { cardId: "card-1" } },
            { type: "text", text: " before the rewrite." },
          ],
        },
      ],
    });

    const html = editor.getHTML();
    expect(html).toContain('data-card-id="card-1"');
    expect(html).toContain("@Design doc");

    editor.commands.setContent(html);
    expect(mentionAttrs(editor)).toEqual(["card-1"]);
  });

  it("should keep the mention inline between the words around it", () => {
    editor = new Editor({
      extensions: [StarterKit, Mention],
      content: '<p>Read <span data-card-id="card-1">@Design doc</span> first</p>',
    });

    const paragraph = editor.state.doc.firstChild;
    expect(paragraph?.childCount).toBe(3);
    expect(paragraph?.child(0).text).toBe("Read ");
    expect(paragraph?.child(1).type.name).toBe("mention");
    expect(paragraph?.child(2).text).toBe(" first");
    expect(mentionAttrs(editor)).toEqual(["card-1"]);
  });
});
