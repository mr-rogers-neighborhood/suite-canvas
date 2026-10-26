import { STARTER_TEMPLATES, templateDetail, WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BOARD_STARTERS,
  createStarterBoard,
  TemplateGallery,
  templateCopyName,
  uniqueBoardName,
} from "./TemplateGallery";

function workspace(): WorkspaceDocument {
  const document = new WorkspaceDocument();
  document.ensureDefaultTypes();
  return document;
}

describe("BOARD_STARTERS", () => {
  it("is the template data from @suite/graph, so a starter cannot drift from it", () => {
    expect(BOARD_STARTERS).toHaveLength(STARTER_TEMPLATES.length);
    for (const [index, template] of STARTER_TEMPLATES.entries()) {
      const starter = BOARD_STARTERS[index];
      expect(starter?.id).toBe(template.id);
      expect(starter?.title).toBe(template.name);
      expect(starter?.detail).toBe(templateDetail(template));
    }
  });

  it("keeps the three shapes the product is used for", () => {
    expect(BOARD_STARTERS.map((starter) => starter.id)).toEqual(["research", "outline", "meeting"]);
  });
});

describe("createStarterBoard", () => {
  it("copies the shape into a new board and returns its id", () => {
    const document = workspace();
    const boardId = createStarterBoard(document, "research", []);
    expect(boardId).not.toBeNull();
    expect(document.getBoard(boardId ?? "")?.name).toBe("Research board");
    const titles = document
      .listBoardCards(boardId ?? "")
      .map((card) => document.displayTitle(card.id));
    expect(titles).toContain("What are we trying to learn?");
    expect(titles).toHaveLength(6);
    expect(document.listSections(boardId ?? "")).toHaveLength(3);
  });

  it("numbers the board when the name is taken", () => {
    const document = workspace();
    const first = createStarterBoard(document, "outline", []);
    const second = createStarterBoard(document, "outline", ["Outline board"]);
    expect(document.getBoard(first ?? "")?.name).toBe("Outline board");
    expect(document.getBoard(second ?? "")?.name).toBe("Outline board 2");
  });

  it("still numbers a copy whose name the caller's list does not have yet", () => {
    const document = workspace();
    createStarterBoard(document, "meeting", []);
    const second = createStarterBoard(document, "meeting", []);
    expect(document.getBoard(second ?? "")?.name).toBe("Meeting board 2");
  });

  it("is one change, so one undo removes the whole starter", () => {
    const document = workspace();
    createStarterBoard(document, "research", []);
    document.undo();
    expect(document.listBoards()).toHaveLength(0);
    expect(document.listCards()).toHaveLength(0);
  });

  it("returns null for an id no starter carries", () => {
    expect(createStarterBoard(workspace(), "nope", [])).toBeNull();
  });
});

describe("naming helpers", () => {
  it("numbers after the names already taken", () => {
    expect(templateCopyName("Board 1", [])).toBe("Board 1 2");
    expect(templateCopyName("Board 1", ["Board 1 2", "Board 1 3"])).toBe("Board 1 4");
    expect(uniqueBoardName("Board 1", [])).toBe("Board 1");
    expect(uniqueBoardName("Board 1", ["Board 1"])).toBe("Board 1 2");
  });
});

describe("TemplateGallery", () => {
  const templates = [
    { id: "t1", title: "Weekly review", open: false, cardCount: 4, template: true },
  ];

  it("shows the workspace's own blueprints above the built-in shapes", () => {
    render(
      <TemplateGallery
        templates={templates}
        starters={BOARD_STARTERS}
        onUseTemplate={() => {}}
        onEditTemplate={() => {}}
      />,
    );
    expect(screen.getByTestId("library-template-t1")).toBeInTheDocument();
    expect(screen.getByTestId("library-templates-divider")).toBeInTheDocument();
    expect(screen.getByTestId("library-starter-research")).toBeInTheDocument();
    expect(within(screen.getByTestId("library-templates")).getAllByRole("button")).toHaveLength(5);
  });

  it("reports which starter was picked", () => {
    const onUseStarter = vi.fn();
    render(
      <TemplateGallery
        templates={[]}
        starters={BOARD_STARTERS}
        onUseTemplate={() => {}}
        onUseStarter={onUseStarter}
        onEditTemplate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("library-starter-use-outline"));
    expect(onUseStarter).toHaveBeenCalledWith("outline");
  });

  it("hides the starter half when the host offers none", () => {
    render(
      <TemplateGallery templates={templates} onUseTemplate={() => {}} onEditTemplate={() => {}} />,
    );
    expect(screen.queryByTestId("library-templates-divider")).toBeNull();
    expect(screen.queryByTestId("library-starter-research")).toBeNull();
  });
});
