import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { ImageLink } from "./imageLinkNode";
import { ImageUrlPrompt, openImageUrlPrompt } from "./imageUrlPrompt";
import { MEDIA_NODE_NAME, Media } from "./mediaNode";
import { filterSlashItems } from "./SlashCommands";

const URL = "https://cdn.example.com/shots/relay.png";

let editor: Editor | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

function createEditor(content = ""): Editor {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit.configure({ undoRedo: false }), ImageLink, Media, ImageUrlPrompt],
    content,
  });
  return editor;
}

/** The media blocks that name a third-party address rather than stored bytes. */
function imageLinks(instance: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  instance.state.doc.descendants((node) => {
    if (node.type.name === MEDIA_NODE_NAME && typeof node.attrs.src === "string") {
      found.push(node.attrs);
    }
    return true;
  });
  return found;
}

/**
 * The `/` menu no longer has an image row: it has one media row, whose picker
 * offers the URL prompt. The prompt itself is what this file is about, so it is
 * opened directly — the picker's routing is `SlashCommands.test.ts`'s subject.
 */
function openFromSlashMenu(instance: Editor): void {
  openImageUrlPrompt(instance);
}

describe("the slash menu's image item", () => {
  it("should be one row that covers every way of adding media", () => {
    // One row, one idea: the kind is the picker's question, not the menu's.
    expect(filterSlashItems("image").map((entry) => entry.id)).toEqual(["media"]);
    expect(filterSlashItems("picture").map((entry) => entry.id)).toEqual(["media"]);
    expect(filterSlashItems("url").map((entry) => entry.id)).toEqual(["media"]);
    expect(filterSlashItems("youtube").map((entry) => entry.id)).toEqual(["media"]);
  });

  it("should ask for a URL in the editor and insert the node on Enter", async () => {
    const instance = createEditor("");
    openFromSlashMenu(instance);

    // Inline: a hint in the paragraph, not a dialog over the document.
    const hint = await screen.findByTestId("image-url-hint");
    expect(hint.textContent).toContain("Paste an image URL, then press Enter");
    expect(screen.queryByRole("dialog")).toBeNull();

    instance.commands.insertContent(URL);
    fireEvent.keyDown(instance.view.dom, { key: "Enter" });

    await waitFor(() => expect(imageLinks(instance)).toHaveLength(1));
    expect(imageLinks(instance)[0]).toMatchObject({
      kind: "image",
      src: URL,
      alt: "relay.png",
      width: null,
      height: null,
    });
    expect(screen.queryByTestId("image-url-hint")).toBeNull();
  });

  it("should give the URL its own line when the block already has text", () => {
    const instance = createEditor("Hello");
    instance.commands.setTextSelection(6);
    openFromSlashMenu(instance);

    instance.commands.insertContent(URL);
    fireEvent.keyDown(instance.view.dom, { key: "Enter" });

    expect(imageLinks(instance)).toHaveLength(1);
    // The text before the menu stays a paragraph of its own.
    expect(instance.state.doc.textContent).toContain("Hello");
    expect(instance.state.doc.textContent).not.toContain(URL);
  });

  it("should keep the prompt and say why when the URL is not allowed", async () => {
    const instance = createEditor("");
    openFromSlashMenu(instance);

    instance.commands.insertContent("javascript:alert(1)");
    fireEvent.keyDown(instance.view.dom, { key: "Enter" });

    const hint = await screen.findByTestId("image-url-hint");
    expect(hint.textContent).toContain("Only http and https links can be shown.");
    expect(hint.className).toContain("is-error");
    expect(imageLinks(instance)).toHaveLength(0);
  });

  it("should close on Escape without touching the document", async () => {
    const instance = createEditor("");
    openFromSlashMenu(instance);

    fireEvent.keyDown(instance.view.dom, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("image-url-hint")).toBeNull());
    expect(imageLinks(instance)).toHaveLength(0);
    expect(instance.state.doc.textContent).toBe("");
  });
});
