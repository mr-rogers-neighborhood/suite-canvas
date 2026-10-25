import { type Card, type CardType, WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { typesById } from "../cards/cardTypes";
import { ensureWhiteboardType, WHITEBOARD_TYPE_ID } from "../cards/whiteboard";
import {
  CARD_FACE_REFERENCES_MARK,
  CARD_FACE_STROKES_MARK,
  CARD_FACE_TAGS_MARK,
  type CardFaceSources,
  cardFaceAtBand,
  cardFaceFrom,
} from "./suiteCardFace";

/**
 * The face as the projection builds it, against a real document: the counts are
 * the document's (not a prop's), a whiteboard's body is its drawing, and the
 * whole thing is one flow the paper truncates.
 */
function workspaceOf() {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const view = doc.ensureView();
  const card = doc.createCard({ boardId: view.id, position: { x: 0, y: 0 } });
  const other = doc.createCard({ boardId: view.id, position: { x: 400, y: 0 } });
  return { doc, view, card, other };
}

/** The editor writes rich text as a Loro tree; `createCard` only makes the map. */
function writeText(container: ReturnType<WorkspaceDocument["getTitle"]>, text: string): void {
  container.set("nodeName", "doc");
  container.ensureMergeableMap("attributes");
  const blocks = container.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
}

function titleOf(doc: WorkspaceDocument, card: Card, text: string): void {
  writeText(doc.getTitle(card.id), text);
}

function bodyOf(doc: WorkspaceDocument, card: Card, text: string): void {
  writeText(doc.getContent(card.id), text);
}

/** The card type the drawing face keys on (`isWhiteboardCard`). */
function makeWhiteboard(doc: WorkspaceDocument, card: Card): void {
  ensureWhiteboardType(doc);
  doc.setCardTypes(card.id, [WHITEBOARD_TYPE_ID], WHITEBOARD_TYPE_ID);
}

function sources(
  doc: WorkspaceDocument,
  overrides: Partial<CardFaceSources> = {},
): CardFaceSources {
  const types = typesById(doc.listTypes());
  return {
    workspace: doc,
    types,
    referencesOf: (cardId) => doc.referencesFor(cardId).length,
    drawingOf: () => null,
    ...overrides,
  };
}

describe("cardFaceFrom", () => {
  it("should say glyph, title and both counts for a plain card", () => {
    const { doc, card, other } = workspaceOf();
    titleOf(doc, card, "Capture first, sort later");
    bodyOf(doc, card, "Drop a thought on the board first.");
    doc.addEdge({
      boardId: doc.ensureView().id,
      source: card.id,
      target: other.id,
      kind: "references",
    });
    const tag = doc.ensureTag("workflow");
    doc.addCardTag(card.id, tag.id);

    const flow = cardFaceFrom(
      sources(doc, {
        referencesOf: (cardId) => (cardId === card.id ? 1 : 0),
      }),
      card.id,
    );
    const [row = "", blank = "", ...rest] = flow.split("\n");
    expect(row).toContain("Capture first, sort later");
    expect(row).toContain(`${CARD_FACE_REFERENCES_MARK}1`);
    expect(row).toContain(`${CARD_FACE_TAGS_MARK}1`);
    expect(row.startsWith("□")).toBe(true);
    expect(blank).toBe("");
    expect(rest.join("\n")).toContain("Drop a thought on the board first.");
  });

  it("should spend no characters on a count that is zero", () => {
    const { doc, card } = workspaceOf();
    titleOf(doc, card, "Lonely");
    const flow = cardFaceFrom(sources(doc), card.id);
    expect(flow).toBe("□ · Lonely");
    expect(flow).not.toContain(CARD_FACE_REFERENCES_MARK);
    expect(flow).not.toContain(CARD_FACE_TAGS_MARK);
  });

  it("should give a whiteboard its stroke count and its sketch instead of text", () => {
    const { doc, card } = workspaceOf();
    makeWhiteboard(doc, card);
    const elements = [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 80, height: 60 },
      { id: "b", type: "ellipse", x: 140, y: 0, width: 80, height: 60 },
    ];
    doc.setDrawing(card.id, elements);

    const flow = cardFaceFrom(
      sources(doc, {
        drawingOf: (cardId) => {
          const drawing = doc.drawing(cardId);
          return drawing === null || drawing.elements.length === 0
            ? null
            : { strokes: drawing.elements.length, sketch: [], empty: false };
        },
      }),
      card.id,
    );
    const [row = ""] = flow.split("\n");
    // No title of its own: the type names the card (ADR-0043 §3's `▤ Whiteboard`).
    expect(row).toContain("Whiteboard");
    expect(row).toContain(`${CARD_FACE_STROKES_MARK}2`);
  });

  it("should carry a whiteboard's sketch lines as the body", () => {
    const { doc, card } = workspaceOf();
    makeWhiteboard(doc, card);
    const flow = cardFaceFrom(
      sources(doc, {
        drawingOf: () => ({ strokes: 3, sketch: ["▁█▁", "███"], empty: false }),
      }),
      card.id,
    );
    expect(flow).toContain(`${CARD_FACE_STROKES_MARK}3`);
    expect(flow.endsWith("▁█▁\n███")).toBe(true);
  });

  it("should say the same thing at every band until the band truncates it", () => {
    const { doc, card } = workspaceOf();
    titleOf(doc, card, "A card");
    bodyOf(doc, card, "With a body.");
    const flow = cardFaceFrom(sources(doc), card.id);
    expect(cardFaceAtBand(flow, "full")).toBe(flow);
    expect(cardFaceAtBand(flow, "compact")).toBe("□ · A card");
    expect(cardFaceAtBand(flow, "icon")).toBe("");
  });

  it("should follow the document: a tag added later reaches the face", () => {
    const { doc, card } = workspaceOf();
    titleOf(doc, card, "Tagged");
    const before = cardFaceFrom(sources(doc), card.id);
    doc.addCardTag(card.id, doc.ensureTag("concept").id);
    expect(before).not.toContain(CARD_FACE_TAGS_MARK);
    expect(cardFaceFrom(sources(doc), card.id)).toContain(`${CARD_FACE_TAGS_MARK}1`);
  });
});

describe("the kind's types", () => {
  it("should keep the fallback glyph for a card whose type is missing", () => {
    const { doc, card } = workspaceOf();
    titleOf(doc, card, "Orphan");
    const empty = new Map<string, CardType>();
    expect(cardFaceFrom(sources(doc, { types: empty }), card.id).startsWith("□")).toBe(true);
  });
});
