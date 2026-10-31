import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { IMAGE_NODE_NAME, ImageLink } from "./imageLinkNode";
import { ImageUrlPrompt } from "./imageUrlPrompt";
import { filterSlashItems, SLASH_ITEMS } from "./SlashCommands";

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
    extensions: [StarterKit.configure({ undoRedo: false }), ImageLink, ImageUrlPrompt],
    content,
  });
  return editor;
}

function item(id: string) {
  const found = SLASH_ITEMS.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing slash item: ${id}`);
  return found;
}

function imageLinks(instance: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  instance.state.doc.descendants((node) => {
    if (node.type.name === IMAGE_NODE_NAME) found.push(node.attrs);
    return true;
  });
  return found;
}

function openFromSlashMenu(instance: Editor): void {
  // The suggestion plugin reports the range of the typed `/image`.
  item("image-url").run(instance, { from: 1, to: 7 });
}

describe("the slash menu's image item", () => {
  it("should be listed for `image` and `url`, next to the other blocks", () => {
    expect(filterSlashItems("image").map((entry) => entry.id)).toEqual([
      "image-upload",
      "image-url",
    ]);
    expect(filterSlashItems("url").map((entry) => entry.id)).toEqual(["image-url"]);
    expect(filterSlashItems("picture").map((entry) => entry.id)).toEqual([
      "image-upload",
      "image-url",
    ]);
  });

  it("should ask for a URL in the editor and insert the node on Enter", async () => {
    const instance = createEditor("/image");
    openFromSlashMenu(instance);

    // Inline: a hint in the paragraph, not a dialog over the document.
    const hint = await screen.findByTestId("image-url-hint");
    expect(hint.textContent).toContain("Paste an image URL, then press Enter");
    expect(screen.queryByRole("dialog")).toBeNull();

    instance.commands.insertContent(URL);
    fireEvent.keyDown(instance.view.dom, { key: "Enter" });

    await waitFor(() => expect(imageLinks(instance)).toHaveLength(1));
    expect(imageLinks(instance)[0]).toEqual({
      src: URL,
      alt: "relay.png",
      width: null,
      height: null,
    });
    expect(screen.queryByTestId("image-url-hint")).toBeNull();
  });

  it("should give the URL its own line when the block already has text", () => {
    const instance = createEditor("Hello /image");
    instance.commands.setTextSelection(7);
    item("image-url").run(instance, { from: 7, to: 13 });

    instance.commands.insertContent(URL);
    fireEvent.keyDown(instance.view.dom, { key: "Enter" });

    expect(imageLinks(instance)).toHaveLength(1);
    // The text before the menu stays a paragraph of its own.
    expect(instance.state.doc.textContent).toContain("Hello");
    expect(instance.state.doc.textContent).not.toContain(URL);
  });

  it("should keep the prompt and say why when the URL is not allowed", async () => {
    const instance = createEditor("/image");
    openFromSlashMenu(instance);

    instance.commands.insertContent("javascript:alert(1)");
    fireEvent.keyDown(instance.view.dom, { key: "Enter" });

    const hint = await screen.findByTestId("image-url-hint");
    expect(hint.textContent).toContain("Only http and https links can be shown.");
    expect(hint.className).toContain("is-error");
    expect(imageLinks(instance)).toHaveLength(0);
  });

  it("should close on Escape without touching the document", async () => {
    const instance = createEditor("/image");
    openFromSlashMenu(instance);

    fireEvent.keyDown(instance.view.dom, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("image-url-hint")).toBeNull());
    expect(imageLinks(instance)).toHaveLength(0);
    expect(instance.state.doc.textContent).toBe("");
  });
});
