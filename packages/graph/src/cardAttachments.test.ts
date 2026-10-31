import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { documentAttachmentIds, documentAttachments, documentMedia } from "./cardAttachments.js";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";

const IMAGE_ID = "0123456789abcdef0123456789abcdef";

/**
 * Writes a body tree holding one image-shaped node. The Loro tree stores
 * `nodeName`/`attributes`, which `loroTreeToJson` projects to `type`/`attrs`;
 * writing it the long way is what the editor binding does.
 */
function writeBodyNode(
  workspace: WorkspaceDocument,
  cardId: string,
  nodeName: string,
  attributes: Record<string, string | number>,
): void {
  const root = workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const node = inline.insertContainer(0, new LoroMap());
  node.set("nodeName", nodeName);
  const attrs = node.ensureMergeableMap("attributes");
  for (const [key, value] of Object.entries(attributes)) attrs.set(key, value);
}

/** The editor writes the title text; `createCard` only creates the container. */
function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string): void {
  const title = workspace.getTitle(cardId);
  const blocks = title.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
}

const imageAttrs = { id: IMAGE_ID, mime: "image/png", name: "beach.png", width: 4, height: 3 };

function twoCards(): { workspace: WorkspaceDocument; first: string; second: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const first = workspace.createCard({ boardId: board.id }).id;
  const second = workspace.createCard({ boardId: board.id }).id;
  writeTitle(workspace, first, "Trip plan");
  writeTitle(workspace, second, "Packing list");
  return { workspace, first, second };
}

describe("documentAttachments", () => {
  it("should find an attachment node in a card body", () => {
    const { workspace, first } = twoCards();
    writeBodyNode(workspace, first, "attachment", imageAttrs);

    expect(documentAttachments(workspace)).toEqual([
      {
        id: IMAGE_ID,
        mime: "image/png",
        name: "beach.png",
        width: 4,
        height: 3,
        cards: [{ id: first, title: "Trip plan" }],
      },
    ]);
  });

  it("should list every card that shows the same image once, with both titles", () => {
    const { workspace, first, second } = twoCards();
    writeBodyNode(workspace, first, "attachment", imageAttrs);
    writeBodyNode(workspace, second, "attachment", imageAttrs);

    const entries = documentAttachments(workspace);
    expect(entries).toHaveLength(1);
    // `listCards` order is the document's, not creation order, so compare as a set.
    const cards = entries[0]?.cards ?? [];
    expect(cards.map((card) => card.id).sort()).toEqual([first, second].sort());
    expect(cards.map((card) => card.title).sort()).toEqual(["Packing list", "Trip plan"]);
  });

  it("should ignore a URL image node, which has no bytes anywhere", () => {
    const { workspace, first, second } = twoCards();
    writeBodyNode(workspace, first, "attachment", imageAttrs);
    writeBodyNode(workspace, second, "image", { src: "https://example.com/a.png", alt: "remote" });

    expect(documentAttachmentIds(workspace)).toEqual([IMAGE_ID]);
  });

  it("should ignore an attachment node with no id rather than emit an empty key", () => {
    const { workspace, first, second } = twoCards();
    writeBodyNode(workspace, first, "attachment", imageAttrs);
    writeBodyNode(workspace, second, "attachment", { mime: "image/png" });

    expect(documentAttachmentIds(workspace)).toEqual([IMAGE_ID]);
  });

  it("should be empty for a workspace with no images", () => {
    const { workspace } = twoCards();
    expect(documentAttachments(workspace)).toEqual([]);
  });
});

describe("documentMedia", () => {
  it("should find a media block, which is what the editor writes now", () => {
    // The regression this pins: media rendered perfectly on the card and never
    // reached the library, because this walk only knew the four legacy nodes.
    const { workspace, first } = twoCards();
    writeBodyNode(workspace, first, "media", {
      kind: "image",
      id: IMAGE_ID,
      mime: "image/png",
      name: "beach.png",
      width: 4,
      height: 3,
      bytes: 900,
    });

    const items = documentMedia(workspace);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: IMAGE_ID,
      kind: "image",
      mime: "image/png",
      name: "beach.png",
      width: 4,
      height: 3,
      bytes: 900,
    });
    expect(items[0]?.cards).toEqual([{ id: first, title: "Trip plan" }]);
  });

  it("should read the kind a media video block declares", () => {
    const { workspace, first } = twoCards();
    writeBodyNode(workspace, first, "media", {
      kind: "video",
      id: IMAGE_ID,
      mime: "video/mp4",
      name: "clip.mp4",
    });

    expect(documentMedia(workspace)[0]).toMatchObject({ kind: "video", name: "clip.mp4" });
    // Stored bytes, so a backup has to copy them.
    expect(documentAttachmentIds(workspace)).toEqual([IMAGE_ID]);
  });

  it("should key an embed by its video id rather than its node", () => {
    const { workspace, first } = twoCards();
    writeBodyNode(workspace, first, "media", {
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
      title: "A talk",
    });

    expect(documentMedia(workspace)[0]).toMatchObject({
      id: "yt_dQw4w9WgXcQ",
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
      name: "A talk",
    });
  });

  it("should list a link image but give a backup nothing to copy", () => {
    const { workspace, first } = twoCards();
    writeBodyNode(workspace, first, "media", {
      kind: "image",
      src: "https://cdn.example.com/a.png",
      alt: "a.png",
    });

    expect(documentMedia(workspace)[0]).toMatchObject({
      id: "https://cdn.example.com/a.png",
      kind: "image",
      url: "https://cdn.example.com/a.png",
      name: "a.png",
    });
    expect(documentAttachments(workspace)).toEqual([]);
  });
});
