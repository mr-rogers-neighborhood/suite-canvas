import { exportPortable, WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import type { ImportReport } from "./report.js";
import { readFixtureVault } from "./test/fixtures.js";
import { importObsidianVault } from "./vault.js";

/**
 * The whole vault, end to end: the fixture is imported once and every assertion
 * reads the document the way the canvas would.
 */

function projectWorkspace(): { workspace: WorkspaceDocument; fields: Record<string, string> } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const project = workspace.createType({ name: "Project", glyph: "\u25c6" });
  const status = workspace.addField(project.id, {
    name: "Status",
    kind: "select",
    options: ["In progress", "Done"],
  });
  const owner = workspace.addField(project.id, { name: "Owner", kind: "text" });
  const reviewed = workspace.addField(project.id, { name: "Reviewed", kind: "date" });
  const pinned = workspace.addField(project.id, { name: "Pinned", kind: "checkbox" });
  return {
    workspace,
    fields: { status: status.id, owner: owner.id, reviewed: reviewed.id, pinned: pinned.id },
  };
}

function imported(): {
  workspace: WorkspaceDocument;
  fields: Record<string, string>;
  report: ImportReport;
} {
  const { workspace, fields } = projectWorkspace();
  const result = importObsidianVault(workspace, {
    files: readFixtureVault(),
    homeBoardName: "Fixture vault",
  });
  if (result.isErr()) throw new Error(result.error.message);
  return { workspace, fields, report: result.value };
}

function cardId(workspace: WorkspaceDocument, title: string): string {
  const card = workspace.listCards().find((entry) => workspace.displayTitle(entry.id) === title);
  if (!card) throw new Error(`No card titled ${title}`);
  return card.id;
}

describe("importObsidianVault", () => {
  it("turns every folder into a board and leaves the hierarchy visible", () => {
    const { workspace, report } = imported();
    expect(
      workspace
        .listBoards()
        .map((board) => board.name)
        .sort(),
    ).toEqual(["Fixture vault", "Plan", "Projects", "Projects / Notes"]);
    expect(report.records.boards).toBe(4);
  });

  it("makes one card per note and titles it from its H1 or its file name", () => {
    const { workspace, report } = imported();
    const titles = workspace.listCards().map((card) => workspace.displayTitle(card.id));
    expect(titles).toContain("Home");
    expect(titles).toContain("Alpha");
    expect(titles).toContain("Deep note");
    expect(report.files.notes).toBe(3);
  });

  it("keeps the note body as rich text, structure included", () => {
    const { workspace } = imported();
    const home = cardId(workspace, "Home");
    const text = workspace.cardText(home);
    expect(text).toContain("First point");
    expect(text).toContain("Nested point");
    expect(text).toContain("Numbered one");

    const alpha = cardId(workspace, "Alpha");
    expect(workspace.cardText(alpha)).toContain("const x = 1;");
  });

  it("maps frontmatter onto the fields the card's type declares", () => {
    const { workspace, fields } = imported();
    const alpha = workspace.getCard(cardId(workspace, "Alpha"));
    expect(alpha).toBeDefined();
    const properties = alpha?.properties ?? {};
    expect(properties[fields.status ?? ""]).toBeTypeOf("string");
    expect(properties[fields.owner ?? ""]).toBe("Ada Lovelace");
    expect(properties[fields.reviewed ?? ""]).toBe("2024-05-01");
    expect(properties[fields.pinned ?? ""]).toBe(true);
  });

  it("keeps a frontmatter key no field claims, in the body and in the report", () => {
    const { workspace, report } = imported();
    const alpha = cardId(workspace, "Alpha");
    expect(workspace.cardText(alpha)).toContain("custom-key: kept as text");
    expect(report.properties.keptAsText).toContainEqual({
      path: "Projects/Alpha.md",
      key: "custom-key",
    });
  });

  it("turns frontmatter and inline tags into tags, and takes the hashtag out of the text", () => {
    const { workspace, report } = imported();
    const names = workspace
      .listTags()
      .map((tag) => tag.name)
      .sort();
    expect(names).toEqual(["current", "deep", "idea", "nested", "project"]);
    expect(report.records.tags).toBe(5);
    expect(workspace.cardText(cardId(workspace, "Home"))).not.toContain("#idea");
  });

  it("resolves wikilinks through the reference index and keeps a missing one as text", () => {
    const { workspace, report } = imported();
    workspace.ensureReferences();
    const home = cardId(workspace, "Home");
    const alpha = cardId(workspace, "Alpha");
    const deep = cardId(workspace, "Deep note");

    expect(workspace.referencesFor(home)).toEqual(expect.arrayContaining([alpha, deep]));
    expect(workspace.referencesFor(deep)).toContain(home);

    const homeText = workspace.cardText(home);
    expect(homeText).toContain("[[Missing note]]");
    expect(report.links.unresolved).toEqual(["Missing note"]);
    expect(report.links.resolved).toBeGreaterThanOrEqual(5);
  });

  it("keeps an embedded file as text and says why", () => {
    const { workspace, report } = imported();
    expect(workspace.cardText(cardId(workspace, "Alpha"))).toContain("diagram.png");
    expect(report.attachments).toEqual([
      { path: "diagram.png", reason: expect.stringContaining("kept as text") },
    ]);
    expect(report.files.attachments).toBe(1);
  });

  it("turns a canvas into a board with all four node types and both edges", () => {
    const { workspace, report } = imported();
    const plan = workspace.listBoards().find((board) => board.name === "Plan");
    expect(plan).toBeDefined();
    const boardId = plan?.id ?? "";

    const sections = workspace.listSections(boardId);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe("Research");
    expect(sections[0]?.color).toBe("green");
    const section = sections[0];
    expect(section?.x).toBe(0);
    expect(section?.width).toBe(760);

    const cards = workspace.listBoardCards(boardId);
    expect(cards).toHaveLength(3);
    const titles = cards.map((card) => workspace.displayTitle(card.id));
    expect(titles).toContain("Alpha");
    expect(titles).toContain("https://obsidian.md");

    const edges = workspace.listBoardEdges(boardId);
    expect(edges).toHaveLength(2);
    expect(report.records.links).toBe(2);
    expect(edges.map((edge) => edge.label)).toContain("supports");
  });

  it("gives a canvas card the geometry the canvas stored", () => {
    const { workspace } = imported();
    const plan = workspace.listBoards().find((board) => board.name === "Plan");
    const boardId = plan?.id ?? "";
    const link = workspace
      .listBoardCards(boardId)
      .find((card) => workspace.displayTitle(card.id) === "https://obsidian.md");
    const placement = workspace.getPlacement(boardId, link?.id ?? "");
    expect(placement?.x).toBe(400);
    expect(placement?.width).toBe(300);
    expect(placement?.height).toBe(140);
  });

  it("maps a canvas colour onto a slot the schema has, and reports the rest", () => {
    const { report } = imported();
    expect(report.colours.sections).toBe(1);
    expect(report.colours.cards).toBe(1);
    expect(report.notes.some((note) => note.includes("edge colour"))).toBe(true);
  });

  it("is one change, so a single undo takes the whole import back", () => {
    const { workspace } = projectWorkspace();
    const result = importObsidianVault(workspace, { files: readFixtureVault() });
    expect(result.isOk()).toBe(true);
    const boards = workspace.listBoards().length;
    workspace.undo();
    expect(workspace.listBoards().length).toBeLessThan(boards);
    expect(workspace.listCards()).toHaveLength(0);
  });

  it("reads back through the portable export, mentions named by title", () => {
    const { workspace } = imported();
    const portable = exportPortable(workspace);
    expect(portable.markdown).toContain("[[Alpha]]");
    expect(portable.markdown).toContain("Ada Lovelace");
  });

  it("refuses a folder with no files instead of reporting an empty import", () => {
    const { workspace } = projectWorkspace();
    const result = importObsidianVault(workspace, { files: [] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("no-files");
  });
});

describe("files it cannot read", () => {
  it("skips Obsidian's settings folder and unknown file types, with reasons", () => {
    const { workspace } = projectWorkspace();
    const result = importObsidianVault(workspace, {
      files: [
        { path: ".obsidian/app.json", text: "{}" },
        { path: "Notes/Kept.md", text: "# Kept\n\nBody" },
        { path: "Notes/thing.bin", text: "\u0000" },
      ],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const paths = result.value.skipped.map((entry) => entry.path);
    expect(paths).toContain(".obsidian/app.json");
    expect(paths).toContain("Notes/thing.bin");
    expect(result.value.files.skipped).toBe(2);
    expect(workspace.listCards()).toHaveLength(1);
  });

  it("reports a canvas it cannot parse rather than failing the vault", () => {
    const { workspace } = projectWorkspace();
    const result = importObsidianVault(workspace, {
      files: [
        { path: "Broken.canvas", text: "{ not json" },
        { path: "Fine.md", text: "# Fine\n\nBody" },
      ],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.skipped[0]?.path).toBe("Broken.canvas");
    expect(workspace.listCards()).toHaveLength(1);
  });
});
