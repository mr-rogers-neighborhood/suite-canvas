import { describe, expect, it } from "vitest";
import { exportPortable } from "../portable.js";
import { readPropertyValue } from "../property.js";
import { outgoingPropertyLinks, propertySources } from "../references.js";
import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID, WorkspaceDocument } from "./WorkspaceDocument.js";

/** Counts commits, because one commit is the unit undo and history care about. */
function countCommits(workspace: WorkspaceDocument): () => number {
  let commits = 0;
  workspace.doc.subscribe(() => {
    commits += 1;
  });
  return () => commits;
}

function setup() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const home = workspace.ensureBoard();
  const target = workspace.createBoard({ name: "Research" });
  return { workspace, home, target };
}

describe("portal type seed", () => {
  it("should seed one portal type with a single required board field", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();

    const portal = workspace.getType(PORTAL_TYPE_ID);
    expect(portal).toMatchObject({
      id: "portal",
      name: "Portal",
      pluralName: "Portals",
      glyph: "\u25c9",
    });
    expect(portal?.fields).toEqual([
      {
        id: PORTAL_BOARD_FIELD_ID,
        name: "Board",
        kind: "board",
        required: true,
        order: 0,
        options: [],
      },
    ]);
  });

  it("should be idempotent and leave a renamed portal type alone", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();

    // A user rename is theirs; re-seeding must not revert it.
    workspace.updateType(PORTAL_TYPE_ID, { name: "Doorway", pluralName: "Doorways" });
    workspace.updateField(PORTAL_TYPE_ID, PORTAL_BOARD_FIELD_ID, { name: "Opens" });
    workspace.ensureDefaultTypes();

    expect(workspace.listTypes().filter((type) => type.id === PORTAL_TYPE_ID)).toHaveLength(1);
    expect(workspace.getType(PORTAL_TYPE_ID)).toMatchObject({
      name: "Doorway",
      pluralName: "Doorways",
    });
    expect(workspace.getType(PORTAL_TYPE_ID)?.fields.map((field) => field.id)).toEqual([
      PORTAL_BOARD_FIELD_ID,
    ]);
    expect(workspace.getType(PORTAL_TYPE_ID)?.fields[0]?.name).toBe("Opens");
  });
});

describe("createPortalCard", () => {
  it("should create a placed portal whose board field holds the target id in one commit", () => {
    const { workspace, home, target } = setup();
    const commits = countCommits(workspace);

    const portal = workspace.createPortalCard({
      boardId: home.id,
      targetBoardId: target.id,
      position: { x: 120, y: 80 },
      id: "p1",
    });

    expect(commits()).toBe(1);
    expect(portal.typeIds).toEqual([PORTAL_TYPE_ID]);
    expect(portal.primaryTypeId).toBe(PORTAL_TYPE_ID);
    expect(portal.properties[PORTAL_BOARD_FIELD_ID]).toBe(target.id);
    expect(workspace.getPlacement(home.id, "p1")).toMatchObject({ x: 120, y: 80 });

    // One undo step takes the card, its property and its placement together.
    workspace.undo();
    expect(workspace.getCard("p1")).toBeUndefined();
    expect(workspace.getPlacement(home.id, "p1")).toBeUndefined();
  });

  it("should refuse a target board that does not exist", () => {
    const { workspace, home } = setup();
    expect(() =>
      workspace.createPortalCard({ boardId: home.id, targetBoardId: "missing" }),
    ).toThrow(/Unknown board/);
    expect(workspace.listCardsOfType(PORTAL_TYPE_ID)).toHaveLength(0);
  });

  it("should seed the portal type when the document was never seeded", () => {
    const workspace = new WorkspaceDocument();
    const home = workspace.ensureBoard();
    const target = workspace.createBoard({ name: "Research" });

    const portal = workspace.createPortalCard({ boardId: home.id, targetBoardId: target.id });

    expect(workspace.getType(PORTAL_TYPE_ID)).toBeDefined();
    expect(portal.properties[PORTAL_BOARD_FIELD_ID]).toBe(target.id);
  });

  it("should leave the portal readable but marked unavailable when the board is deleted", () => {
    const { workspace, home, target } = setup();
    const portal = workspace.createPortalCard({ boardId: home.id, targetBoardId: target.id });
    const field = workspace.getType(PORTAL_TYPE_ID)?.fields[0];
    expect(field).toBeDefined();
    if (!field) return;

    workspace.deleteBoard(target.id);

    const stored = workspace.getCard(portal.id);
    expect(stored?.deletedAt).toBeNull();
    expect(stored?.properties[PORTAL_BOARD_FIELD_ID]).toBe(target.id);
    expect(workspace.getPlacement(home.id, portal.id)).toBeDefined();

    const board = workspace.getBoard(target.id);
    expect(
      readPropertyValue(field, stored?.properties[PORTAL_BOARD_FIELD_ID], {
        boardName: board?.name,
        boardPresence: board ? "board" : "missing",
      }),
    ).toEqual({ text: "Unavailable board", notShared: false });
  });
});

describe("portal built-ins are protected", () => {
  it("should refuse to delete the portal type", () => {
    const { workspace } = setup();
    expect(() => workspace.deleteType(PORTAL_TYPE_ID)).toThrow(/portal type cannot be deleted/);
    expect(workspace.getType(PORTAL_TYPE_ID)).toBeDefined();
  });

  it("should refuse to remove the portal board field", () => {
    const { workspace } = setup();
    expect(() => workspace.removeField(PORTAL_TYPE_ID, PORTAL_BOARD_FIELD_ID)).toThrow(
      /portal board field cannot be removed/,
    );
    expect(workspace.getType(PORTAL_TYPE_ID)?.fields.map((field) => field.id)).toEqual([
      PORTAL_BOARD_FIELD_ID,
    ]);
  });

  it("should still allow extra portal fields", () => {
    const { workspace } = setup();
    const extra = workspace.addField(PORTAL_TYPE_ID, { name: "Note", kind: "text" });
    workspace.removeField(PORTAL_TYPE_ID, extra.id);
    expect(workspace.getType(PORTAL_TYPE_ID)?.fields.map((field) => field.id)).toEqual([
      PORTAL_BOARD_FIELD_ID,
    ]);
  });
});

describe("a board value is never a card reference", () => {
  it("should be ignored by backlink and property-link helpers", () => {
    const { workspace, home, target } = setup();
    // A card whose id happens to equal the target board id: the trap this checks.
    workspace.createCard({ id: target.id, boardId: home.id });
    const portal = workspace.createPortalCard({ boardId: home.id, targetBoardId: target.id });
    const cards = workspace.listCards();
    const types = workspace.listTypes();

    expect(propertySources(target.id, cards, types)).toEqual([]);
    expect(outgoingPropertyLinks(portal.id, cards, types).map((link) => link.cardId)).not.toContain(
      target.id,
    );
    expect(workspace.referencesFor(portal.id)).toEqual([]);
  });

  it("should read as the live board name in the Markdown export", () => {
    const { workspace, home, target } = setup();
    workspace.createPortalCard({ boardId: home.id, targetBoardId: target.id });

    const markdown = exportPortable(workspace).markdown;

    expect(markdown).toContain("| Board | Research |");
  });
});
