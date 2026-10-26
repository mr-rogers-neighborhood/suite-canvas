import { describe, expect, it } from "vitest";
import type { PortableNode } from "../../portable.js";
import { loroTreeToJson } from "../../portable.js";
import { WorkspaceDocument } from "../WorkspaceDocument.js";
import { paragraphNode, textNodes } from "./richText.js";

function seeded(): { workspace: WorkspaceDocument; cardId: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  return { workspace, cardId: card.id };
}

describe("setTitleText", () => {
  it("writes a title the canvas reads back", () => {
    const { workspace, cardId } = seeded();
    expect(workspace.setTitleText(cardId, "Timeline")).toBe(true);
    expect(workspace.displayTitle(cardId)).toBe("Timeline");
  });

  it("replaces the title rather than appending to it", () => {
    const { workspace, cardId } = seeded();
    workspace.setTitleText(cardId, "First");
    workspace.setTitleText(cardId, "Second");
    expect(workspace.displayTitle(cardId)).toBe("Second");
  });

  it("refuses a card that is gone", () => {
    const { workspace } = seeded();
    expect(workspace.setTitleText("missing", "Nope")).toBe(false);
  });
});

describe("setBodyText", () => {
  it("writes one paragraph per line", () => {
    const { workspace, cardId } = seeded();
    workspace.setBodyText(cardId, "First line\n\nThird line");
    const tree = loroTreeToJson(workspace.peekContent(cardId))[0]?.content ?? [];
    expect(tree).toHaveLength(3);
    expect(tree.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(workspace.cardText(cardId)).toContain("Third line");
  });
});

describe("setBodyNodes", () => {
  it("round-trips a tree with a heading, marks and a mention", () => {
    const { workspace, cardId } = seeded();
    const target = workspace.createCard({ boardId: "board-1", position: { x: 0, y: 0 } });
    const nodes: PortableNode[] = [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Sources" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "linked",
            marks: [{ type: "link", attrs: { href: "https://x.test" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "mention", attrs: { cardId: target.id } }],
      },
    ];

    expect(workspace.setBodyNodes(cardId, nodes)).toBe(true);
    const written = loroTreeToJson(workspace.peekContent(cardId))[0]?.content ?? [];
    expect(written).toEqual(nodes);
  });

  it("feeds the reference index, so a link written this way is a real reference", () => {
    const { workspace, cardId } = seeded();
    const target = workspace.createCard({ boardId: "board-1", position: { x: 0, y: 0 } });
    workspace.setBodyNodes(cardId, [
      { type: "paragraph", content: [{ type: "mention", attrs: { cardId: target.id } }] },
    ]);
    workspace.ensureReferences();
    expect(workspace.referencesFor(cardId)).toContain(target.id);
  });

  it("refuses a node the editor cannot render", () => {
    const { workspace, cardId } = seeded();
    expect(() => workspace.setBodyNodes(cardId, [{ type: "blink" }])).toThrow(/cannot render/u);
  });

  it("refuses a mark the editor cannot render", () => {
    const { workspace, cardId } = seeded();
    expect(() =>
      workspace.setBodyNodes(cardId, [
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "glow" }] }] },
      ]),
    ).toThrow(/cannot render/u);
  });
});

describe("node helpers", () => {
  it("builds an empty paragraph for a blank line", () => {
    expect(textNodes("")).toEqual([{ type: "paragraph" }]);
  });

  it("keeps marks off a run that has none", () => {
    expect(paragraphNode([{ text: "plain" }])).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "plain" }],
    });
  });
});
