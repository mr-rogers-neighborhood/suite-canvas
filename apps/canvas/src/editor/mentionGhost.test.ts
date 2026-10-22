import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionGhost, mentionGhostKey } from "./mentionGhost";

// The chip and the picker need a live workspace; the plugin does not.
vi.mock("../components/MentionChip", () => ({ MentionChipNodeView: () => null }));
vi.mock("./SuggestionList", () => ({ mentionSuggestion: {}, titleForCardId: () => "" }));

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(content = "note"): Editor {
  editor = new Editor({ extensions: [StarterKit, MentionGhost], content });
  return editor;
}

describe("MentionGhost", () => {
  it("should draw the shadow after the caret without touching the text", () => {
    const current = createEditor("note");
    const end = current.state.doc.content.size - 1;
    current.view.dispatch(
      current.state.tr.setMeta(mentionGhostKey, { pos: end, text: "Target card" }),
    );

    expect(mentionGhostKey.getState(current.state)).toEqual({ pos: end, text: "Target card" });
    // The decoration renders, and the document still holds only what was typed.
    expect(current.view.dom.querySelector(".mention-ghost")?.textContent).toBe("Target card");
    expect(current.state.doc.textContent).toBe("note");
    expect(current.getText()).not.toContain("Target");
  });

  it("should clear the shadow when the text changes", () => {
    const current = createEditor("no");
    current.view.dispatch(current.state.tr.setMeta(mentionGhostKey, { pos: 3, text: "te" }));
    expect(mentionGhostKey.getState(current.state)).not.toBeNull();

    // The caret starts a document at position 1, so `x` lands before `no`.
    current.commands.insertContent("x");

    // Typing is the reader disagreeing with the suggestion: the shadow goes.
    expect(mentionGhostKey.getState(current.state)).toBeNull();
    expect(current.state.doc.textContent).toBe("xno");
    expect(current.view.dom.querySelector(".mention-ghost")).toBeNull();
  });

  it("should clear the shadow when the caret moves", () => {
    const current = createEditor("note");
    current.view.dispatch(current.state.tr.setMeta(mentionGhostKey, { pos: 5, text: "s" }));
    expect(mentionGhostKey.getState(current.state)).not.toBeNull();

    current.commands.setTextSelection(1);

    expect(mentionGhostKey.getState(current.state)).toBeNull();
  });

  it("should keep the shadow across a meta-only transaction", () => {
    const current = createEditor("note");
    current.view.dispatch(current.state.tr.setMeta(mentionGhostKey, { pos: 5, text: "s" }));

    // Repainting the list re-sends the same shadow; that must not clear it.
    current.view.dispatch(current.state.tr.setMeta("other", true));

    expect(mentionGhostKey.getState(current.state)).toEqual({ pos: 5, text: "s" });
  });
});
