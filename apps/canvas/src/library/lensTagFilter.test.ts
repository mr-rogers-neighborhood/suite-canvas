import {
  emptyViewQuery,
  runViewQuery,
  sectionForCard,
  type ViewQuery,
  WorkspaceDocument,
} from "@suite/graph";
import { describe, expect, it } from "vitest";

/**
 * A lens can carry a tag filter (ADR-0053 §6). The tag selects the card that
 * carries it *and* the cards inside a section that carries it — the section tag
 * is a queryable grouping — while section membership keeps coming from geometry
 * alone. This is the query the canvas lens runs, so it is the same rule the
 * library's facet applies.
 */

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const section = workspace.createSection({
    boardId: board.id,
    title: "Research",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
  });
  const inside = workspace.createCard({ boardId: board.id, position: { x: 40, y: 40 } });
  const outside = workspace.createCard({ boardId: board.id, position: { x: 2000, y: 2000 } });
  const labelled = workspace.createCard({ boardId: board.id, position: { x: 3000, y: 3000 } });
  const tag = workspace.createTag({ name: "research" });
  return { workspace, board, section, inside, outside, labelled, tag };
}

function selects(workspace: WorkspaceDocument, query: Partial<ViewQuery>, boardId?: string) {
  const context = boardId === undefined ? {} : { boardId };
  const result = runViewQuery(workspace, { ...emptyViewQuery(), ...query }, context);
  return new Set(result.cardIds);
}

describe("lens tag filter", () => {
  it("selects a card by its own tag", () => {
    const { workspace, tagged, tag } = (() => {
      const base = setup();
      base.workspace.addCardTag(base.labelled.id, base.tag.id);
      return { workspace: base.workspace, tagged: base.labelled, tag: base.tag };
    })();

    expect(selects(workspace, { tagIds: [tag.id] })).toEqual(new Set([tagged.id]));
  });

  it("selects the cards inside a tagged section, and only those", () => {
    const { workspace, section, inside, outside, labelled, tag } = setup();
    workspace.addSectionTag(section.id, tag.id);

    const selected = selects(workspace, { tagIds: [tag.id] });

    expect(selected.has(inside.id)).toBe(true);
    expect(selected.has(outside.id)).toBe(false);
    expect(selected.has(labelled.id)).toBe(false);
  });

  it("answers for both a card's own tag and its section's", () => {
    const { workspace, section, inside, labelled, tag } = setup();
    workspace.addSectionTag(section.id, tag.id);
    workspace.addCardTag(labelled.id, tag.id);

    expect(selects(workspace, { tagIds: [tag.id] })).toEqual(new Set([inside.id, labelled.id]));
  });

  it("keeps the section scope: a tagged section on another board does not match", () => {
    const { workspace, board, section, inside, labelled, tag } = setup();
    workspace.addSectionTag(section.id, tag.id);
    workspace.addCardTag(labelled.id, tag.id);
    const other = workspace.createBoard({ name: "Other" });
    const elsewhere = workspace.createCard({ boardId: other.id, position: { x: 0, y: 0 } });
    workspace.addCardTag(elsewhere.id, tag.id);

    // `inside` is only on Home, so a Home-scoped lens still selects it; the
    // card carrying the tag on another board does not appear.
    const selected = selects(workspace, { tagIds: [tag.id], scope: "board" }, board.id);
    expect(selected.has(inside.id)).toBe(true);
    expect(selected.has(elsewhere.id)).toBe(false);
  });

  it("reads the tag without moving the card out of the section", () => {
    const { workspace, board, section, inside, tag } = setup();
    const placement = workspace.getPlacement(board.id, inside.id);
    expect(placement).toBeDefined();

    workspace.addSectionTag(section.id, tag.id);
    selects(workspace, { tagIds: [tag.id] });

    const after = workspace.getPlacement(board.id, inside.id);
    expect(after?.x).toBe(placement?.x);
    expect(after?.y).toBe(placement?.y);
    expect(sectionForCard(after ?? { x: 0, y: 0 }, workspace.listSections())?.id).toBe(section.id);
  });

  it("drops a tag whose record is gone instead of stranding the view", () => {
    const { workspace, section, tag } = setup();
    workspace.addSectionTag(section.id, tag.id);
    workspace.deleteTag(tag.id);

    // The facet id no longer names anything, so the group stops narrowing —
    // the same rule `runViewQuery` applies to a deleted type or section.
    expect(selects(workspace, { tagIds: [tag.id] }).size).toBe(3);
  });
});
