import fc from "fast-check";
import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { buildSearchText, normalizeSearchText, searchCards } from "./search.js";

const CARD_ID = "c1";

/** Words keep a precomposed accent in the pool: folding is what search tests. */
const wordArb = fc.stringMatching(/^[A-Za-zéÉüÜ]{1,6}$/u);

const wordsArb = fc.array(wordArb, { minLength: 0, maxLength: 4 });

function addParagraph(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const value = inline.insertContainer(0, new LoroText());
  if (text.length > 0) value.insert(0, text);
}

function addTitle(workspace: WorkspaceDocument, text: string): void {
  const root = workspace.getTitle(CARD_ID);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  addParagraph(root, text);
}

function addBody(workspace: WorkspaceDocument, text: string): void {
  const root = workspace.getContent(CARD_ID);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  addParagraph(root, text);
}

function card(title: readonly string[], body: readonly string[]): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureView();
  workspace.createCard({ id: CARD_ID, boardId: board.id, position: { x: 0, y: 0 } });
  addTitle(workspace, title.join(" "));
  addBody(workspace, body.join(" "));
  workspace.doc.commit({ origin: "test" });
  return workspace;
}

describe("searchCards properties", () => {
  it("never misses a card for a term drawn from its own title or body", () => {
    fc.assert(
      fc.property(
        wordsArb,
        wordsArb,
        fc.constantFrom("title", "body"),
        fc.nat(),
        fc.nat(),
        (title, body, field, fromWord, toWord) => {
          const words = field === "title" ? title : body;
          fc.pre(words.length > 0);

          const from = fromWord % words.length;
          const to = toWord % words.length;
          const [low, high] = from <= to ? [from, to] : [to, from];
          const raw = words.slice(low, high + 1).join(" ");
          const term = normalizeSearchText(raw);
          fc.pre(term.length > 0);

          const workspace = card(title, body);
          const hits = searchCards(buildSearchText(workspace), term, { limit: 20 });

          expect(
            hits.map((hit) => hit.id),
            `query ${JSON.stringify(term)} missed a card titled ${JSON.stringify(title.join(" "))} with body ${JSON.stringify(body.join(" "))}`,
          ).toContain(CARD_ID);
        },
      ),
      { numRuns: 80, verbose: true },
    );
  });
});
