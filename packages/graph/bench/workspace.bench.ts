import { describe, test } from "vitest";
import * as Y from "yjs";
import { WorkspaceDocument } from "../src/index.js";

/**
 * Spike benchmark for the document-boundary decision. It compares three shapes:
 *
 * 1. current: one workspace Y.Doc, which is production today.
 * 2. separate rooms: one index Y.Doc plus independent per-card Y.Docs.
 * 3. subdocs: one root index Y.Doc with each card body embedded as a Yjs subdoc.
 *
 * Scope: Yjs encoding and in-memory access only. No Hocuspocus provider and no
 * IndexedDB are involved, so network and persistence latency are not measured.
 */
const SIZES = [100, 1_000, 5_000] as const;
const BENCH_OPTIONS = { iterations: 5, warmupIterations: 1 } as const;
// tinybench 6 applies time budgets at the bench level, not per task.
const BENCH_RUN_OPTIONS = { ...BENCH_OPTIONS, time: 150, warmupTime: 30 } as const;
const BODY_TEXT = "A card body is a few paragraphs of thinking, links, and notes. "
  .repeat(4)
  .trim();

interface CurrentFixture {
  doc: Y.Doc;
  workspace: WorkspaceDocument;
  cardIds: string[];
}

/** One index doc plus one independent doc per card body. */
interface SeparateRoomsFixture {
  index: Y.Doc;
  cardDocs: Y.Doc[];
  bodyUpdates: Uint8Array[];
  indexBytes: number;
  oneCardBytes: number;
  totalBytes: number;
}

/** One root doc whose card bodies are Yjs subdocs. */
interface SubdocsFixture {
  root: Y.Doc;
  rootUpdate: Uint8Array;
  cardDocs: Y.Doc[];
  bodyUpdates: Uint8Array[];
  rootBytes: number;
  subdocCount: number;
  oneCardBytes: number;
  totalBytes: number;
}

function insertParagraph(fragment: Y.XmlFragment, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  fragment.insert(0, [paragraph]);
}

function buildCurrent(count: number): CurrentFixture {
  const doc = new Y.Doc();
  const workspace = new WorkspaceDocument(doc);
  const board = workspace.ensureBoard();
  const cardIds: string[] = [];

  doc.transact(() => {
    for (let index = 0; index < count; index += 1) {
      const card = workspace.createCard({
        boardId: board.id,
        position: { x: (index % 50) * 260, y: Math.floor(index / 50) * 180 },
      });
      cardIds.push(card.id);
      insertParagraph(workspace.getContent(card.id), BODY_TEXT);
      insertParagraph(workspace.getTitle(card.id), `Card ${index}`);
    }
    for (let index = 1; index < count; index += 1) {
      workspace.addEdge({
        boardId: board.id,
        source: cardIds[index - 1] as string,
        target: cardIds[index] as string,
      });
    }
  });

  return { doc, workspace, cardIds };
}

function createCardBody(): Y.Doc {
  const cardDoc = new Y.Doc();
  insertParagraph(cardDoc.getXmlFragment("body"), BODY_TEXT);
  return cardDoc;
}

function writeCardSummary(cards: Y.Map<Y.Map<unknown>>, cardId: string, position: number): void {
  const summary = new Y.Map<unknown>();
  summary.set("title", `Card ${position}`);
  summary.set("typeId", "note");
  summary.set("tags", ["inbox"]);
  summary.set("updatedAt", 1_700_000_000_000 + position);
  cards.set(cardId, summary);
}

function writeCardPlacement(
  placements: Y.Map<Y.Map<unknown>>,
  cardId: string,
  position: number,
): void {
  const placement = new Y.Map<unknown>();
  placement.set("boardId", "board-1");
  placement.set("x", (position % 50) * 260);
  placement.set("y", Math.floor(position / 50) * 180);
  placement.set("z", position);
  placements.set(cardId, placement);
}

function buildSeparateRooms(count: number): SeparateRoomsFixture {
  const index = new Y.Doc();
  const cards = index.getMap<Y.Map<unknown>>("cards");
  const placements = index.getMap<Y.Map<unknown>>("placements");
  const cardDocs: Y.Doc[] = [];

  index.transact(() => {
    for (let position = 0; position < count; position += 1) {
      const cardId = `card-${position}`;
      writeCardSummary(cards, cardId, position);
      writeCardPlacement(placements, cardId, position);

      const cardDoc = createCardBody();
      cardDocs.push(cardDoc);
    }
  });

  const indexBytes = Y.encodeStateAsUpdate(index).byteLength;
  const bodyUpdates = cardDocs.map((cardDoc) => Y.encodeStateAsUpdate(cardDoc));
  const bodyBytes = bodyUpdates.reduce((total, update) => total + update.byteLength, 0);

  return {
    index,
    cardDocs,
    bodyUpdates,
    indexBytes,
    oneCardBytes: bodyUpdates[0]?.byteLength ?? 0,
    totalBytes: indexBytes + bodyBytes,
  };
}

function buildSubdocs(count: number): SubdocsFixture {
  const root = new Y.Doc();
  const cards = root.getMap<Y.Map<unknown>>("cards");
  const placements = root.getMap<Y.Map<unknown>>("placements");
  const cardDocMap = root.getMap<Y.Doc>("cardDocs");
  const cardDocs: Y.Doc[] = [];

  root.transact(() => {
    for (let position = 0; position < count; position += 1) {
      const cardId = `card-${position}`;
      writeCardSummary(cards, cardId, position);
      writeCardPlacement(placements, cardId, position);

      const cardDoc = createCardBody();
      cardDocMap.set(cardId, cardDoc);
      cardDocs.push(cardDoc);
    }
  });

  // Yjs stores only a subdoc reference (guid + options) in the root update;
  // the body travels in the subdoc's own update, not in the root.
  const rootUpdate = Y.encodeStateAsUpdate(root);
  const bodyUpdates = cardDocs.map((cardDoc) => Y.encodeStateAsUpdate(cardDoc));
  const bodyBytes = bodyUpdates.reduce((total, update) => total + update.byteLength, 0);

  return {
    root,
    rootUpdate,
    cardDocs,
    bodyUpdates,
    rootBytes: rootUpdate.byteLength,
    subdocCount: root.getSubdocs().size,
    oneCardBytes: bodyUpdates[0]?.byteLength ?? 0,
    totalBytes: rootUpdate.byteLength + bodyBytes,
  };
}

function firstSubdoc(doc: Y.Doc): Y.Doc {
  const subdoc = doc.getSubdocs().values().next().value;
  if (subdoc === undefined) {
    throw new Error("expected decoded root to contain a subdoc");
  }
  return subdoc;
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const current = new Map<number, CurrentFixture>();
const separateRooms = new Map<number, SeparateRoomsFixture>();
const subdocs = new Map<number, SubdocsFixture>();

function currentFixture(size: number): CurrentFixture {
  const fixture = current.get(size) ?? buildCurrent(size);
  current.set(size, fixture);
  return fixture;
}

function separateRoomsFixture(size: number): SeparateRoomsFixture {
  const fixture = separateRooms.get(size) ?? buildSeparateRooms(size);
  separateRooms.set(size, fixture);
  return fixture;
}

function subdocsFixture(size: number): SubdocsFixture {
  const fixture = subdocs.get(size) ?? buildSubdocs(size);
  subdocs.set(size, fixture);
  return fixture;
}

describe("document boundaries", () => {
  for (const size of SIZES) {
    test(`${size} cards`, async ({ bench, expect }) => {
      const currentData = currentFixture(size);
      const roomsData = separateRoomsFixture(size);
      const subdocData = subdocsFixture(size);
      const currentBytes = Y.encodeStateAsUpdate(currentData.doc).byteLength;
      const oneCardUpdate = roomsData.bodyUpdates[0] as Uint8Array;
      const oneSubdocUpdate = subdocData.bodyUpdates[0] as Uint8Array;

      console.log(
        [
          `[yjs-encoding-only] ${size} cards`,
          `current=${kib(currentBytes)}`,
          `separate-index=${kib(roomsData.indexBytes)}`,
          `one-card=${kib(roomsData.oneCardBytes)}`,
          `separate-index+bodies=${kib(roomsData.totalBytes)}`,
          `subdocs-root=${kib(subdocData.rootBytes)} (refs only)`,
          `subdocs=${subdocData.subdocCount}`,
          `one-subdoc=${kib(subdocData.oneCardBytes)}`,
          `subdocs-root+bodies=${kib(subdocData.totalBytes)}`,
        ].join("  "),
      );

      await bench.compare(
        bench("current: encode whole workspace", BENCH_OPTIONS, () => {
          Y.encodeStateAsUpdate(currentData.doc);
        }),
        bench("current: read all cards", BENCH_OPTIONS, () => {
          currentData.workspace.listCards();
        }),
        bench("separate rooms: encode index only", BENCH_OPTIONS, () => {
          Y.encodeStateAsUpdate(roomsData.index);
        }),
        bench("separate rooms: encode one card doc", BENCH_OPTIONS, () => {
          Y.encodeStateAsUpdate(roomsData.cardDocs[0] as Y.Doc);
        }),
        bench("separate rooms: open one card doc", BENCH_OPTIONS, () => {
          const cardDoc = new Y.Doc();
          Y.applyUpdate(cardDoc, oneCardUpdate);
        }),
        bench("subdocs: encode root (body refs only)", BENCH_OPTIONS, () => {
          Y.encodeStateAsUpdate(subdocData.root);
        }),
        bench("subdocs: decode root + load() one subdoc", BENCH_OPTIONS, () => {
          const decodedRoot = new Y.Doc();
          Y.applyUpdate(decodedRoot, subdocData.rootUpdate);
          firstSubdoc(decodedRoot).load();
        }),
        bench("subdocs: open one subdoc (local)", BENCH_OPTIONS, () => {
          const decodedRoot = new Y.Doc();
          Y.applyUpdate(decodedRoot, subdocData.rootUpdate);
          const subdoc = firstSubdoc(decodedRoot);
          subdoc.load();
          Y.applyUpdate(subdoc, oneSubdocUpdate);
        }),
        bench("subdocs: apply one subdoc body", BENCH_OPTIONS, () => {
          const body = new Y.Doc();
          Y.applyUpdate(body, oneSubdocUpdate);
        }),
        BENCH_RUN_OPTIONS,
      );

      expect(currentData.workspace.listCards()).toHaveLength(size);
      expect(subdocData.subdocCount).toBe(size);
    });
  }
});
