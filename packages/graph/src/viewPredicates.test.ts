import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { ATTACHMENT_NODE_NAME } from "./portable.js";
import type { PropertyOp, ViewPredicate, ViewPredicateGroup } from "./viewPredicates.js";
import {
  emptyViewQuery,
  groupViewResult,
  runView,
  type SavedView,
  type ViewQuery,
} from "./views.js";

function addNode(parent: LoroMap, name: string): LoroMap {
  const children = parent.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", name);
  return node;
}

function addText(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const value = children.insertContainer(children.length, new LoroText());
  value.insert(0, text);
}

function addParagraphs(body: LoroMap, ...paragraphs: string[]): void {
  for (const paragraph of paragraphs) addText(addNode(body, "paragraph"), paragraph);
}

function addAttachment(body: LoroMap): void {
  addNode(addNode(body, "paragraph"), ATTACHMENT_NODE_NAME);
}

interface Fixture {
  workspace: WorkspaceDocument;
  boardId: string;
  character: string;
  fields: {
    score: string;
    due: string;
    status: string;
    skills: string;
    done: string;
    related: string;
    optionDone: string;
    optionDraft: string;
  };
  tagId: string;
}

/**
 * Four character cards with typed fields, plus one note.
 *
 * | card | score | due          | status | skills        | done | related |
 * | c1   | 10    | 2026-01-01   | draft  | co, wr        | yes  | c2      |
 * | c2   | 40    | 2026-06-01   | done   | wr            | no   | —       |
 * | c3   | —     | —            | —      | —             | —    | —       |
 * | c4   | 25    | 2026-03-01   | draft  | —             | yes  | —       |
 */
function fixture(): Fixture {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.createType({ id: "character", name: "Character" });
  const score = workspace.addField("character", { name: "Score", kind: "number" });
  const due = workspace.addField("character", { name: "Due", kind: "date" });
  const status = workspace.addField("character", {
    name: "Status",
    kind: "select",
    options: ["Draft", "Done"],
  });
  const skills = workspace.addField("character", {
    name: "Skills",
    kind: "multiSelect",
    options: ["Co", "Wr"],
  });
  const done = workspace.addField("character", { name: "Done", kind: "checkbox" });
  const related = workspace.addField("character", { name: "Related", kind: "card" });
  const tag = workspace.createTag({ name: "draft" });

  const optionDone = status.options[1]?.id ?? "";
  const optionDraft = status.options[0]?.id ?? "";

  const spots: Record<string, { x: number; y: number }> = {
    c1: { x: 0, y: 0 },
    c2: { x: 400, y: 0 },
    c3: { x: 800, y: 0 },
    c4: { x: 1200, y: 0 },
  };
  for (const [id, position] of Object.entries(spots)) {
    workspace.createCard({ id, typeId: "character", boardId: board.id, position });
  }
  workspace.createCard({ id: "c5", boardId: board.id, position: { x: 1600, y: 0 } });

  addText(workspace.getTitle("c1"), "Alpha");
  addParagraphs(workspace.getContent("c1"), "pacing notes");
  workspace.setProperty("c1", score.id, 10);
  workspace.setProperty("c1", due.id, "2026-01-01");
  workspace.setProperty("c1", status.id, optionDraft);
  workspace.setProperty("c1", skills.id, [
    skills.options[0]?.id ?? "",
    skills.options[1]?.id ?? "",
  ]);
  workspace.setProperty("c1", done.id, true);
  workspace.setProperty("c1", related.id, "c2");
  workspace.addCardTag("c1", tag.id);

  addText(workspace.getTitle("c2"), "Beta");
  addParagraphs(workspace.getContent("c2"), "colour grading");
  workspace.setProperty("c2", score.id, 40);
  workspace.setProperty("c2", due.id, "2026-06-01");
  workspace.setProperty("c2", status.id, optionDone);
  workspace.setProperty("c2", skills.id, [skills.options[1]?.id ?? ""]);
  workspace.setProperty("c2", done.id, false);

  addText(workspace.getTitle("c3"), "Gamma");
  addParagraphs(workspace.getContent("c3"), "timeline of releases");

  addText(workspace.getTitle("c4"), "Delta");
  workspace.setProperty("c4", score.id, 25);
  workspace.setProperty("c4", due.id, "2026-03-01");
  workspace.setProperty("c4", status.id, optionDraft);
  workspace.setProperty("c4", done.id, true);

  addText(workspace.getTitle("c5"), "Loose");
  addParagraphs(workspace.getContent("c5"), "attachment holder");
  addAttachment(workspace.getContent("c5"));

  workspace.doc.commit({ origin: "test" });
  // The app repairs the derived reference index on load; a query reads it as-is.
  workspace.ensureReferences();
  return {
    workspace,
    boardId: board.id,
    character: "character",
    fields: {
      score: score.id,
      due: due.id,
      status: status.id,
      skills: skills.id,
      done: done.id,
      related: related.id,
      optionDone,
      optionDraft,
    },
    tagId: tag.id,
  };
}

function query(patch: Partial<ViewQuery>): ViewQuery {
  return { ...emptyViewQuery(), ...patch };
}

/** One group holding `predicates` as an OR. */
function group(...predicates: ViewPredicate[]): ViewPredicateGroup[] {
  return [{ any: predicates }];
}

function property(fieldId: string, op: PropertyOp, value?: unknown): ViewPredicate {
  return { p: "property", fieldId, op, ...(value === undefined ? {} : { value: value as never }) };
}

function view(patch: Partial<ViewQuery>): SavedView {
  return { id: "v1", name: "Saved", position: 0, query: query(patch) };
}

/** Sorted ids, for tests about membership rather than order. */
function membership(
  workspace: WorkspaceDocument,
  patch: Partial<ViewQuery>,
  context: { boardId?: string | null } = {},
): string[] {
  return [...runView(workspace, view(patch), context).cardIds].sort();
}

describe("view property predicates", () => {
  it("should compare numbers with every ordering operator", () => {
    const { workspace, fields } = fixture();
    const byScore = (op: PropertyOp, value?: unknown) =>
      membership(workspace, { groups: group(property(fields.score, op, value)) });

    expect(byScore("eq", 10)).toEqual(["c1"]);
    // "not 10" includes a character that never set the field: it is not 10.
    expect(byScore("neq", 10)).toEqual(["c2", "c3", "c4"]);
    expect(byScore("lt", 20)).toEqual(["c1"]);
    expect(byScore("lte", 25)).toEqual(["c1", "c4"]);
    expect(byScore("gt", 25)).toEqual(["c2"]);
    expect(byScore("gte", 25)).toEqual(["c2", "c4"]);
    expect(byScore("between", [10, 25])).toEqual(["c1", "c4"]);
    // A note has no Score field at all, so only `empty` reads as true for it.
    expect(byScore("empty")).toEqual(["c3", "c5"]);
    expect(byScore("notEmpty")).toEqual(["c1", "c2", "c4"]);
  });

  it("should compare dates as instants, not as strings", () => {
    const { workspace, fields } = fixture();
    const between = (low: string, high: string) =>
      membership(workspace, {
        groups: group(property(fields.due, "between", [low, high])),
      });
    expect(between("2026-01-15", "2026-04-01")).toEqual(["c4"]);
    expect(between("2026-05-01", "2026-12-31")).toEqual(["c2"]);
  });

  it("should match select options by id", () => {
    const { workspace, fields } = fixture();
    const byStatus = (op: PropertyOp, value?: unknown) =>
      membership(workspace, { groups: group(property(fields.status, op, value)) });

    expect(byStatus("eq", fields.optionDraft)).toEqual(["c1", "c4"]);
    expect(byStatus("in", [fields.optionDone])).toEqual(["c2"]);
    // c3 is a character with no status, so it is not "Draft".
    expect(byStatus("neq", fields.optionDraft)).toEqual(["c2", "c3"]);
    expect(byStatus("empty")).toEqual(["c3", "c5"]);
  });

  it("should treat multi-select as an intersection", () => {
    const { workspace, fields } = fixture();
    const options = workspace
      .getType("character")
      ?.fields.find((field) => field.id === fields.skills)
      ?.options.map((option) => option.id);
    const [co, wr] = options ?? [];
    const bySkills = (op: PropertyOp, value: string[]) =>
      membership(workspace, { groups: group(property(fields.skills, op, value)) });

    expect(bySkills("in", [co ?? ""])).toEqual(["c1"]);
    expect(bySkills("in", [wr ?? ""])).toEqual(["c1", "c2"]);
    // c3/c4 never set the field ("not Co"); c5 is a note, outside the domain.
    expect(bySkills("notIn", [co ?? ""])).toEqual(["c2", "c3", "c4"]);
  });

  it("should read a checkbox as boolean", () => {
    const { workspace, fields } = fixture();
    const done = (value: boolean) =>
      membership(workspace, { groups: group(property(fields.done, "eq", value)) });
    expect(done(true)).toEqual(["c1", "c4"]);
    expect(done(false)).toEqual(["c2"]);
  });

  it("should match a card-valued field by id", () => {
    const { workspace, fields } = fixture();
    expect(membership(workspace, { groups: group(property(fields.related, "eq", "c2")) })).toEqual([
      "c1",
    ]);
    expect(membership(workspace, { groups: group(property(fields.related, "empty")) })).toEqual([
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("should ignore a field the card's type does not declare", () => {
    const { workspace, fields } = fixture();
    // A leftover key on a note must not match a property of another type.
    workspace.createCard({ id: "stray", boardId: "board-1" });
    const stray = workspace.getCard("stray");
    if (stray) workspace.setCard({ ...stray, properties: { [fields.score]: 10 } });

    expect(membership(workspace, { groups: group(property(fields.score, "eq", 10)) })).toEqual([
      "c1",
    ]);
  });

  it("should ignore a property predicate whose field was deleted", () => {
    const { workspace, fields } = fixture();
    const patch = { groups: group(property(fields.score, "eq", 10)) };
    workspace.removeField("character", fields.score);
    expect(() => runView(workspace, view(patch))).not.toThrow();
    expect(membership(workspace, patch)).toEqual([]);
  });
});

describe("view presence and relation predicates", () => {
  it("should find cards with a body, an attachment, a backlink or a property", () => {
    const { workspace, fields } = fixture();
    const presence = (of: "body" | "attachment" | "backlink" | "property", fieldId?: string) =>
      membership(workspace, {
        groups: group({ p: "presence", of, ...(fieldId ? { fieldId } : {}) }),
      });

    expect(presence("body")).toEqual(["c1", "c2", "c3", "c5"]);
    expect(presence("attachment")).toEqual(["c5"]);
    // c1 points at c2 through a card-valued field, so c2 is the card with a link in.
    expect(presence("backlink")).toEqual(["c2"]);
    expect(presence("property", fields.score)).toEqual(["c1", "c2", "c4"]);
  });

  it("should follow one hop of a link in either direction", () => {
    const { workspace } = fixture();
    const relation = (dir: "in" | "out", cardId: string) =>
      membership(workspace, { groups: group({ p: "relation", dir, cardId }) });

    // c1 points at c2, so c1 has an outgoing link to c2 and c2 has one from c1.
    expect(relation("out", "c2")).toEqual(["c1"]);
    expect(relation("in", "c1")).toEqual(["c2"]);
    expect(relation("in", "c3")).toEqual([]);
  });

  it("should count a drawn arrow as a link in both directions", () => {
    const { workspace, boardId } = fixture();
    workspace.addEdge({ boardId, source: "c3", target: "c4" });
    workspace.doc.commit({ origin: "test" });

    expect(
      membership(workspace, { groups: group({ p: "relation", dir: "out", cardId: "c4" }) }),
    ).toEqual(["c3"]);
    expect(
      membership(workspace, { groups: group({ p: "relation", dir: "in", cardId: "c3" }) }),
    ).toEqual(["c4"]);
  });

  it("should scope text to the title or the body", () => {
    const { workspace } = fixture();
    // "timeline" is a body term on c3 only.
    expect(membership(workspace, { text: "timeline" })).toEqual(["c3"]);
    expect(membership(workspace, { text: "timeline", textScope: "title" })).toEqual([]);
    expect(membership(workspace, { text: "timeline", textScope: "body" })).toEqual(["c3"]);

    // A word that only appears in a body is unreachable from title scope.
    addParagraphs(workspace.getContent("c2"), "Alpha again");
    workspace.doc.commit({ origin: "test" });
    expect(membership(workspace, { text: "alpha", textScope: "title" })).toEqual(["c1"]);
    expect(membership(workspace, { text: "alpha", textScope: "body" })).toEqual(["c2"]);
  });

  it("should apply the text predicate inside a group with its own scope", () => {
    const { workspace } = fixture();
    expect(
      membership(workspace, {
        groups: group({ p: "text", terms: "grading", scope: "body" }),
      }),
    ).toEqual(["c2"]);
    expect(
      membership(workspace, {
        groups: group({ p: "text", terms: "grading", scope: "title" }),
      }),
    ).toEqual([]);
  });
});

describe("view predicate groups", () => {
  it("should OR inside a group and AND across groups", () => {
    const { workspace, fields, tagId } = fixture();
    const highScore = property(fields.score, "gte", 25);

    expect(membership(workspace, { groups: group(highScore) })).toEqual(["c2", "c4"]);
    expect(
      membership(workspace, {
        groups: [{ any: [highScore] }, { any: [{ p: "tag", ids: [tagId] }] }],
      }),
    ).toEqual([]);
    expect(
      membership(workspace, {
        groups: [{ any: [highScore] }, { any: [{ p: "type", ids: ["character"] }] }],
      }),
    ).toEqual(["c2", "c4"]);
    // Two predicates in one `any` are an OR, not an AND.
    expect(
      membership(workspace, {
        groups: group(highScore, { p: "tag", ids: [tagId] }),
      }),
    ).toEqual(["c1", "c2", "c4"]);
  });

  it("should veto a card when a not predicate matches", () => {
    const { workspace, fields } = fixture();
    expect(
      membership(workspace, {
        groups: [
          { any: [{ p: "type", ids: ["character"] }] },
          { not: [property(fields.done, "eq", true)] },
        ],
      }),
    ).toEqual(["c2", "c3"]);
  });

  it("should treat an empty group as no constraint", () => {
    const { workspace } = fixture();
    expect(membership(workspace, { groups: [{}] })).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(membership(workspace, { groups: [] })).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("should combine facets and groups", () => {
    const { workspace, fields } = fixture();
    expect(
      membership(workspace, {
        typeIds: ["character"],
        groups: group(property(fields.done, "eq", true)),
      }),
    ).toEqual(["c1", "c4"]);
  });
});

describe("view sorts and grouping", () => {
  it("should apply explicit sorts with a stable tiebreak", () => {
    const { workspace, fields } = fixture();
    const stamps: Record<string, number> = { c1: 10, c2: 20, c3: 30, c4: 40 };
    for (const [id, createdAt] of Object.entries(stamps)) {
      const card = workspace.getCard(id);
      if (card) workspace.setCard({ ...card, createdAt });
    }
    expect(
      runView(
        workspace,
        view({
          typeIds: ["character"],
          sorts: [{ by: "created", dir: "asc" }],
          // `order` must not win when explicit sorts are present.
          order: "updated",
        }),
      ).cardIds,
    ).toEqual(["c1", "c2", "c3", "c4"]);

    expect(
      runView(
        workspace,
        view({
          typeIds: ["character"],
          sorts: [{ by: "title", dir: "desc" }],
        }),
      ).cardIds,
    ).toEqual(["c3", "c4", "c2", "c1"]);

    // Sorting by a property is a v2 feature only through `sorts` on a key that
    // exists; an unknown key is rejected by the schema.
    expect(() =>
      workspace.createView({
        name: "Bad",
        query: query({ sorts: [{ by: "score" as never, dir: "asc" }] }),
      }),
    ).toThrow();
    expect(fields.score).toBeTruthy();
  });

  it("should sort cards without a section last", () => {
    const { workspace, boardId } = fixture();
    workspace.createSection({
      id: "s1",
      boardId,
      title: "Act one",
      x: -50,
      y: -50,
      width: 200,
      height: 200,
    });
    workspace.doc.commit({ origin: "test" });

    const result = runView(
      workspace,
      view({ typeIds: ["character"], sorts: [{ by: "section", dir: "asc" }] }),
      { boardId },
    );
    expect(result.cardIds[0]).toBe("c1");
    expect(result.cardIds.at(-1)).not.toBe("c1");
  });

  it("should group a result without changing its selection", () => {
    const { workspace, fields } = fixture();
    const result = runView(workspace, view({ typeIds: ["character"] }));
    const groups = groupViewResult(
      workspace,
      query({ typeIds: ["character"], groupBy: "type" }),
      result,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("character");
    expect([...(groups[0]?.cardIds ?? [])].sort()).toEqual([...result.cardIds].sort());
    expect(fields.status).toBeTruthy();

    const byTag = groupViewResult(
      workspace,
      query({ typeIds: ["character"], groupBy: "tag" }),
      result,
    );
    // One tagged card in a named group, the rest in the closing "no group" bucket.
    expect(byTag.at(-1)?.key).toBeNull();
    expect(byTag.at(-1)?.cardIds.length).toBe(result.cardIds.length - 1);
  });

  it("should read the v1 grouping flag as a groupBy", () => {
    const { workspace, boardId } = fixture();
    workspace.createSection({
      id: "s1",
      boardId,
      title: "Act one",
      x: -50,
      y: -50,
      width: 200,
      height: 200,
    });
    workspace.doc.commit({ origin: "test" });
    const result = runView(workspace, view({ typeIds: ["character"] }));
    const groups = groupViewResult(
      workspace,
      query({ typeIds: ["character"], groupBySection: true }),
      result,
    );
    // c1 sits in the section; the other three share the closing "no section" bucket.
    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe("s1");
    expect(groups[0]?.cardIds).toEqual(["c1"]);
    expect(groups.at(-1)?.key).toBeNull();
    expect(groups.at(-1)?.cardIds).toHaveLength(3);
  });
});

describe("view query schema", () => {
  it("should keep accepting a v1 query", () => {
    const { workspace } = fixture();
    const v1 = workspace.createView({
      name: "V1",
      query: query({ text: "alpha", typeIds: ["character"], groupBySection: false }),
    });
    expect(workspace.getView(v1.id)?.query.groups).toBeUndefined();
    expect(runView(workspace, v1).cardIds).toEqual(["c1"]);
  });

  it("should reject an unknown predicate or operator", () => {
    const { workspace } = fixture();
    const badPredicate = {
      ...emptyViewQuery(),
      groups: [{ any: [{ p: "nonsense" }] }],
    } as unknown as ViewQuery;
    expect(() => workspace.createView({ name: "Bad", query: badPredicate })).toThrow();

    const badOp = {
      ...emptyViewQuery(),
      groups: [{ any: [{ p: "property", fieldId: "f", op: "sounds-like" }] }],
    } as unknown as ViewQuery;
    expect(() => workspace.createView({ name: "Bad", query: badOp })).toThrow();
  });

  it("should accept a full v2 query and round-trip it", () => {
    const { workspace, fields } = fixture();
    const full = query({
      text: "notes",
      textScope: "body",
      groups: [
        {
          any: [
            { p: "property", fieldId: fields.score, op: "gte", value: 10 },
            { p: "presence", of: "attachment" },
          ],
          not: [{ p: "tag", ids: ["draft"] }],
        },
      ],
      groupBy: "section",
      sorts: [
        { by: "updated", dir: "desc" },
        { by: "title", dir: "asc" },
      ],
    });
    const created = workspace.createView({ name: "Full", query: full });
    expect(workspace.getView(created.id)?.query).toEqual(full);

    const reopened = new WorkspaceDocument();
    reopened.importSnapshot(workspace.exportSnapshot());
    expect(reopened.getView(created.id)?.query).toEqual(full);
  });
});
