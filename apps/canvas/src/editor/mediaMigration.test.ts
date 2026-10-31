import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { cardBodySchemaExtensions } from "./cardEditorExtensions";
import { migrateLegacyMedia } from "./mediaMigration";
import { MEDIA_NODE_NAME } from "./mediaNode";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(): Editor {
  editor = new Editor({
    extensions: cardBodySchemaExtensions({ cardId: "migration-card" }),
    content: "<p></p>",
  });
  return editor;
}

/** Every media block in the document, in order. */
function mediaBlocks(instance: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  instance.state.doc.descendants((node) => {
    if (node.type.name === MEDIA_NODE_NAME) found.push(node.attrs);
    return true;
  });
  return found;
}

/** Applies whatever the migration proposes, the way `CardBodyEditor` does. */
function runMigration(instance: Editor): boolean {
  const transaction = migrateLegacyMedia(instance.state);
  if (transaction === null) return false;
  instance.view.dispatch(transaction);
  return true;
}

describe("lazy media migration", () => {
  it("should turn a legacy image link into an image block", () => {
    const instance = createEditor();
    instance.commands.setContent('<img src="https://cdn.example.com/a.png" alt="a.png">');

    expect(runMigration(instance)).toBe(true);
    expect(mediaBlocks(instance)).toHaveLength(1);
    expect(mediaBlocks(instance)[0]).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/a.png",
      alt: "a.png",
    });
  });

  it("should keep a stored attachment's id and mime", () => {
    const instance = createEditor();
    instance.commands.setContent(
      '<img data-attachment-id="fedcba9876543210fedcba9876543210" data-attachment-mime="image/png" data-attachment-width="800" data-attachment-height="600" data-attachment-name="shot.png">',
    );

    expect(runMigration(instance)).toBe(true);
    expect(mediaBlocks(instance)[0]).toMatchObject({
      kind: "image",
      id: "fedcba9876543210fedcba9876543210",
      mime: "image/png",
      width: 800,
      height: 600,
      name: "shot.png",
    });
  });

  it("should read the mime to tell an attached video from an attached image", () => {
    const instance = createEditor();
    instance.commands.setContent({
      type: "video",
      attrs: {
        id: "fedcba9876543210fedcba9876543210",
        mime: "video/mp4",
        name: "clip.mp4",
      },
    });

    expect(runMigration(instance)).toBe(true);
    expect(mediaBlocks(instance)[0]).toMatchObject({ kind: "video", name: "clip.mp4" });
  });

  it("should carry a YouTube embed across as an embed", () => {
    const instance = createEditor();
    instance.commands.setContent({
      type: "youtube",
      attrs: { videoId: "dQw4w9WgXcQ", title: "Talk" },
    });

    expect(runMigration(instance)).toBe(true);
    expect(mediaBlocks(instance)[0]).toMatchObject({
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
      title: "Talk",
    });
  });

  it("should propose nothing the second time, so no empty undo entry is written", () => {
    const instance = createEditor();
    instance.commands.setContent('<img src="https://cdn.example.com/a.png" alt="a.png">');

    expect(runMigration(instance)).toBe(true);
    expect(runMigration(instance)).toBe(false);
    expect(mediaBlocks(instance)).toHaveLength(1);
  });

  it("should leave a picture that shares its paragraph with text alone", () => {
    const instance = createEditor();
    // A block cannot sit inside a paragraph, and splitting prose the reader wrote
    // is worse than leaving one legacy node in the tree.
    instance.commands.setContent(
      'Lead in <img data-attachment-id="fedcba9876543210fedcba9876543210" data-attachment-mime="image/png" data-attachment-name="inline.png"> tail',
    );

    expect(runMigration(instance)).toBe(false);
    expect(mediaBlocks(instance)).toHaveLength(0);
    expect(instance.state.doc.textContent).toContain("Lead in");
  });
});
