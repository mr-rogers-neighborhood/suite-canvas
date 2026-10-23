import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { documentAttachmentIds, documentAttachments } from "./cardAttachments.js";
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
