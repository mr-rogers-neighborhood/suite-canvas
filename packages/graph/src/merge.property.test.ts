import fc from "fast-check";
import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { applyPublish, type PublishScope, planPublish } from "./merge.js";
import { projectWorkspace } from "./projection.js";
import { type EdgePath, edgePaths, type SectionColor, sectionColors } from "./schema.js";

const BOARD = "board-1";
const CARD_IDS = ["c1", "c2", "c3"] as const;
type CardKey = (typeof CARD_IDS)[number];

/**
 * Roots a publish may write. `types`, `tags` and `boards` are schema/board
 * metadata a publish never changes, and a projection copies only the subset a
 * share needs, so comparing them would compare fixtures, not the publish.
 * `references` and `meta` are derived, not data.
 */
const DATA_ROOTS = [
  WorkspaceDocument.CARDS_KEY,
  WorkspaceDocument.PLACEMENTS_KEY,
  WorkspaceDocument.EDGES_KEY,
  WorkspaceDocument.SECTIONS_KEY,
  WorkspaceDocument.CONTENT_KEY,
  WorkspaceDocument.TITLES_KEY,
] as const;

/**
 * Timestamps come from `Date.now()` on both sides, so they are not part of what
 * a publish is expected to make equal. Everything else is compared verbatim.
 */
function stripTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTimestamps);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "createdAt" || key === "updatedAt") continue;
      out[key] = stripTimestamps(child);
    }
    return out;
  }
  return value;
}

function dataSnapshot(workspace: WorkspaceDocument): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of DATA_ROOTS) {
    snapshot[key] = stripTimestamps(workspace.doc.getMap(key).toJSON());
  }
  return snapshot;
}

interface Fixture {
  source: WorkspaceDocument;
  baseline: WorkspaceDocument;
  draft: WorkspaceDocument;
  options: PublishScope;
  ownerId: string;
  tagId: string;
  sectionId: string;
  edgeId: string;
}

function writeBlocks(
  workspace: WorkspaceDocument,
  cardId: string,
  which: "title" | "body",
  paragraphs: readonly string[],
): void {
  const root = which === "title" ? workspace.getTitle(cardId) : workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();
  paragraphs.forEach((text, index) => {
    const paragraph = blocks.insertContainer(index, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    const value = inline.insertContainer(0, new LoroText());
    if (text.length > 0) value.insert(0, text);
  });
  workspace.doc.commit({ origin: "test" });
}

function fixture(): Fixture {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.ensureBoard();
  // Fields, tags and edges mint random ids; the fixture captures them and
  // never asserts on their value, so nothing depends on unseeded randomness.
  const owner = source.addField("note", { name: "Owner", kind: "text" });
  const tag = source.createTag({ name: "Important" });
  const section = source.createSection({
    id: "section-1",
    boardId: BOARD,
    title: "Plan",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    color: "blue",
  });

  for (const [index, cardId] of CARD_IDS.entries()) {
    source.createCard({ id: cardId, boardId: BOARD, position: { x: index * 200, y: 20 } });
    writeBlocks(source, cardId, "title", [`Card ${cardId}`]);
    writeBlocks(source, cardId, "body", [`First body of ${cardId}`, `Second body of ${cardId}`]);
  }
  source.addCardTag("c1", tag.id);
  source.setProperty("c1", owner.id, "Ada");
  source.doc.commit({ origin: "test" });

  const edge = source.addEdge({ boardId: BOARD, source: "c1", target: "c2" });
  if (!edge) throw new Error("fixture edge missing");

  const options: PublishScope = { scope: "board", boardId: BOARD };
  return {
    source,
    baseline: projectWorkspace(source, options).workspace,
    draft: projectWorkspace(source, options).workspace,
    options,
    ownerId: owner.id,
    tagId: tag.id,
    sectionId: section.id,
    edgeId: edge.id,
  };
}

type Edit =
  | { op: "title"; card: CardKey; text: string }
  | { op: "body"; card: CardKey; paragraphs: string[] }
  | { op: "property"; card: CardKey; value: string | null }
  | { op: "tag"; card: CardKey; present: boolean }
  | { op: "move"; card: CardKey; x: number; y: number }
  | { op: "resize"; card: CardKey; width: number; height: number }
  | { op: "unplace"; card: CardKey }
  | { op: "sectionTitle"; title: string }
  | { op: "sectionGeometry"; x: number; y: number; width: number; height: number }
  | { op: "sectionColor"; color: SectionColor }
  | { op: "edgePath"; path: EdgePath }
  | { op: "edgeLabel"; label: string | null };

const cardArb = fc.constantFrom(...CARD_IDS);
const textArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,15}$/u);
const paragraphsArb = fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,15}$/u), {
  minLength: 0,
  maxLength: 2,
});

const editArb: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ op: fc.constant("title" as const), card: cardArb, text: textArb }),
  fc.record({ op: fc.constant("body" as const), card: cardArb, paragraphs: paragraphsArb }),
  fc.record({
    op: fc.constant("property" as const),
    card: cardArb,
    value: fc.option(textArb, { nil: null }),
  }),
  fc.record({ op: fc.constant("tag" as const), card: cardArb, present: fc.boolean() }),
  fc.record({
    op: fc.constant("move" as const),
    card: cardArb,
    x: fc.integer({ min: -40, max: 400 }),
    y: fc.integer({ min: -40, max: 300 }),
  }),
  fc.record({
    op: fc.constant("resize" as const),
    card: cardArb,
    width: fc.integer({ min: 10, max: 400 }),
    height: fc.integer({ min: 10, max: 300 }),
  }),
  fc.record({ op: fc.constant("unplace" as const), card: cardArb }),
  fc.record({ op: fc.constant("sectionTitle" as const), title: textArb }),
  fc.record({
    op: fc.constant("sectionGeometry" as const),
    x: fc.integer({ min: -40, max: 200 }),
    y: fc.integer({ min: -40, max: 200 }),
    width: fc.integer({ min: 20, max: 800 }),
    height: fc.integer({ min: 20, max: 600 }),
  }),
  fc.record({
    op: fc.constant("sectionColor" as const),
    color: fc.constantFrom(...sectionColors),
  }),
  fc.record({ op: fc.constant("edgePath" as const), path: fc.constantFrom(...edgePaths) }),
  fc.record({
    op: fc.constant("edgeLabel" as const),
    label: fc.option(textArb, { nil: null }),
  }),
);

function applyEdits(target: Fixture, edits: readonly Edit[]): void {
  for (const edit of edits) {
    switch (edit.op) {
      case "title":
        writeBlocks(target.draft, edit.card, "title", [edit.text]);
        break;
      case "body":
        writeBlocks(target.draft, edit.card, "body", edit.paragraphs);
        break;
      case "property":
        target.draft.setProperty(edit.card, target.ownerId, edit.value);
        break;
      case "tag":
        if (edit.present) target.draft.addCardTag(edit.card, target.tagId);
        else target.draft.removeCardTag(edit.card, target.tagId);
        break;
      case "move":
        target.draft.movePlacements(BOARD, [{ cardId: edit.card, x: edit.x, y: edit.y }]);
        break;
      case "resize":
        target.draft.updatePlacementSize(BOARD, edit.card, {
          width: edit.width,
          height: edit.height,
        });
        break;
      case "unplace":
        target.draft.unplaceCard(BOARD, edit.card);
        break;
      case "sectionTitle":
        target.draft.renameSection(target.sectionId, edit.title);
        break;
      case "sectionGeometry":
        target.draft.updateSectionGeometry(target.sectionId, {
          x: edit.x,
          y: edit.y,
          width: edit.width,
          height: edit.height,
        });
        break;
      case "sectionColor":
        target.draft.setSectionColor(target.sectionId, edit.color);
        break;
      case "edgePath":
        target.draft.setEdgePath(target.edgeId, edit.path);
        break;
      case "edgeLabel":
        target.draft.setEdgeLabel(target.edgeId, edit.label);
        break;
    }
  }
}

/** A plan for a draft whose only changes are the generated edits. */
function planFor(edits: readonly Edit[]): {
  target: Fixture;
  plan: ReturnType<typeof planPublish>;
} {
  const target = fixture();
  applyEdits(target, edits);
  const plan = planPublish(target.draft, target.baseline, target.source, target.options);
  // The source was never touched, so nothing the draft changed can conflict.
  expect(plan.conflicts, JSON.stringify(edits)).toEqual([]);
  expect(plan.unsupported, JSON.stringify(edits)).toEqual([]);
  return { target, plan };
}

describe("publish plan properties", () => {
  it("applying a conflict-free plan twice leaves the source byte-identical to applying it once", () => {
    fc.assert(
      fc.property(fc.array(editArb, { minLength: 0, maxLength: 6 }), (edits) => {
        const { target, plan } = planFor(edits);
        applyPublish(target.source, target.draft, plan);
        const once = target.source.doc.toJSON();

        const reapplied = applyPublish(target.source, target.draft, plan);
        const twice = target.source.doc.toJSON();

        // Every other `applyChange` branch compares before writing, so
        // replaying a plan must be a no-op. The `property` branch does not:
        // setting the same value re-writes it and bumps the card's `updatedAt`
        // (which is why the JSON comparison below can also fail), and clearing
        // an already-clear property reports an applied change although
        // `clearProperty` writes nothing. Both are reported, not encoded away.
        //
        // The plan captures values at planning time, so a replay is exactly the
        // "same plan twice" case and no source read can excuse the extra write.
        expect(
          reapplied,
          `replaying ${JSON.stringify(edits)} reported ${reapplied} applied change(s)`,
        ).toBe(0);
        expect(twice, `replaying ${JSON.stringify(edits)} changed the source`).toEqual(once);
      }),
      { numRuns: 50, verbose: true },
    );
  }, 30_000);

  it("publishes every change of a conflict-free plan and changes nothing the draft left alone", () => {
    fc.assert(
      fc.property(fc.array(editArb, { minLength: 1, maxLength: 6 }), (edits) => {
        const { target, plan } = planFor(edits);
        applyPublish(target.source, target.draft, plan);

        // The fixture holds exactly one board and every card lives on it, so the
        // raw maps are the board-scope view (including cards the draft unplaced,
        // whose text a publish must still carry). Equality with the draft proves
        // both halves at once: every drafted title, body, property, tag,
        // placement, section and edge reached the source, and every field the
        // draft did not touch still matches it.
        expect(dataSnapshot(target.source), JSON.stringify(edits)).toEqual(
          dataSnapshot(target.draft),
        );
      }),
      { numRuns: 50, verbose: true },
    );
  }, 30_000);

  it("plans nothing at all for a draft identical to its baseline", () => {
    fc.assert(
      fc.property(fc.array(editArb, { minLength: 0, maxLength: 6 }), (edits) => {
        const target = fixture();
        // Vary the source itself, so the no-change draft is not always the same
        // document: the edited workspace becomes the source of two projections.
        applyEdits(target, edits);
        const source = target.draft;
        const baseline = projectWorkspace(source, target.options).workspace;
        const draft = projectWorkspace(source, target.options).workspace;

        const plan = planPublish(draft, baseline, source, target.options);
        expect(plan.changes).toEqual([]);
        expect(plan.conflicts).toEqual([]);
        expect(plan.unsupported).toEqual([]);
        expect(Object.keys(plan.values)).toEqual([]);
        expect(applyPublish(source, draft, plan)).toBe(0);

        // The literal `draft === baseline` shape is empty as well.
        const samePlan = planPublish(draft, draft, source, target.options);
        expect(samePlan.changes).toEqual([]);
        expect(samePlan.conflicts).toEqual([]);
        expect(samePlan.unsupported).toEqual([]);
      }),
      { numRuns: 50, verbose: true },
    );
  }, 30_000);
});
