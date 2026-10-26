import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import {
  applyWorkspaceTemplate,
  findWorkspaceTemplate,
  STARTER_TEMPLATES,
  templateCopyName,
  templateDetail,
  templateSummary,
  uniqueBoardName,
  workspaceTemplateSchema,
} from "./workspaceTemplate.js";

function empty(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  return workspace;
}

describe("the authored data", () => {
  it("parses through the schema", () => {
    expect(() => workspaceTemplateSchema.array().parse(STARTER_TEMPLATES)).not.toThrow();
  });

  it("gives every template a unique id and a version", () => {
    const ids = STARTER_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(STARTER_TEMPLATES.every((template) => template.version >= 1)).toBe(true);
  });

  it("counts what it writes from the data, so the row cannot drift", () => {
    const research = findWorkspaceTemplate("research");
    expect(research).toBeDefined();
    if (!research) return;
    expect(templateSummary(research)).toEqual({ boards: 1, sections: 3, cards: 6 });
    expect(templateDetail(research)).toBe("3 sections \u00b7 6 cards");
  });

  it("has no template id it cannot find", () => {
    expect(findWorkspaceTemplate("nope")).toBeUndefined();
  });
});

describe("applyWorkspaceTemplate", () => {
  it("writes the board, its regions and one card per authored entry", () => {
    const workspace = empty();
    const result = applyWorkspaceTemplate(workspace, "research");
    expect(result).not.toBeNull();
    expect(result?.boardIds).toHaveLength(1);
    expect(result?.sectionIds).toHaveLength(3);
    expect(result?.cardIds).toHaveLength(6);

    const boardId = result?.boardIds[0] ?? "";
    expect(workspace.listBoardCards(boardId)).toHaveLength(6);
    expect(workspace.listSections(boardId).map((section) => section.title)).toEqual([
      "Questions",
      "Sources",
      "Findings",
    ]);
  });

  it("gives every card a real title", () => {
    const workspace = empty();
    applyWorkspaceTemplate(workspace, "outline");
    const titles = workspace.listCards().map((card) => workspace.displayTitle(card.id));
    expect(titles).toContain("Main claim");
    expect(titles).not.toContain("Untitled");
  });

  it("lands as one change, so one undo removes the whole template", () => {
    const workspace = empty();
    applyWorkspaceTemplate(workspace, "meeting");
    expect(workspace.listBoards()).toHaveLength(1);
    workspace.undo();
    expect(workspace.listBoards()).toHaveLength(0);
    expect(workspace.listCards()).toHaveLength(0);
  });

  it("numbers the second copy instead of colliding with the first", () => {
    const workspace = empty();
    applyWorkspaceTemplate(workspace, "research");
    applyWorkspaceTemplate(workspace, "research");
    expect(workspace.listBoards().map((board) => board.name)).toEqual([
      "Research board",
      "Research board 2",
    ]);
  });

  it("writes card bodies, labels and colours an authored template carries", () => {
    const workspace = empty();
    const template = workspaceTemplateSchema.parse({
      id: "custom",
      name: "Custom",
      description: "One card",
      version: 1,
      boards: [
        {
          name: "Custom board",
          tags: ["active"],
          sections: [
            {
              title: "Region",
              x: 0,
              y: 0,
              width: 360,
              height: 320,
              color: "blue",
              cards: [
                { title: "Card", body: "Line one\nLine two", x: 36, y: 56, tags: ["source"] },
              ],
            },
          ],
        },
      ],
    });

    const result = applyWorkspaceTemplate(workspace, template);
    const boardId = result?.boardIds[0] ?? "";
    const cardId = result?.cardIds[0] ?? "";
    const section = workspace.listSections(boardId)[0];

    expect(section?.color).toBe("blue");
    expect(workspace.cardText(cardId)).toContain("Line two");
    expect(workspace.getBoard(boardId)?.tags).toHaveLength(1);
    const card = workspace.getCard(cardId);
    expect(card?.tags).toHaveLength(1);
    expect(workspace.getTag(card?.tags[0] ?? "")?.name).toBe("source");
    expect(result?.tagIds).toHaveLength(2);
  });

  it("returns null for an id no template carries", () => {
    expect(applyWorkspaceTemplate(empty(), "nope")).toBeNull();
  });
});

describe("naming", () => {
  it("numbers a copy after the taken names", () => {
    expect(templateCopyName("Board 1", [])).toBe("Board 1 2");
    expect(templateCopyName("Board 1", ["Board 1 2", "Board 1 3"])).toBe("Board 1 4");
  });

  it("keeps the name when it is free", () => {
    expect(uniqueBoardName("Research board", [])).toBe("Research board");
    expect(uniqueBoardName("Research board", ["Research board"])).toBe("Research board 2");
  });
});
