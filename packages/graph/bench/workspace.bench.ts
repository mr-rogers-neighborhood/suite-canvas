import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { describe, test } from "vitest";
import { WorkspaceDocument } from "../src/index.js";

/**
 * Compares the two Loro document shapes that matter for the card-boundary
 * decision:
 *
 * 1. current: one workspace doc containing every card title and body.
 * 2. separate rooms: one index doc plus one independent doc per card body.
 *
 * Scope: Loro snapshot encoding and in-memory access only. The sync server and
 * IndexedDB are not involved, so network and persistence latency are not
 * measured.
 */
const SIZES = [100, 1_000, 5_000] as const;
const BENCH_OPTIONS = { iterations: 5, warmupIterations: 1 } as const;
const BENCH_RUN_OPTIONS = { ...BENCH_OPTIONS, time: 150, warmupTime: 30 } as const;
const BENCH_TEST_TIMEOUT_MS = 180_000;
const BODY_TEXT = "A card body is a few paragraphs of thinking, links, and notes. "
  .repeat(4)
  .trim();

function writeParagraph(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const textChildren = paragraph.ensureMergeableList("children");
  textChildren.insertContainer(0, new LoroText()).insert(0, text);
}

function encode(doc: LoroDoc): Uint8Array {
  return doc.export({ mode: "snapshot" });
}

interface CurrentFixture {
  doc: LoroDoc;
  workspace: WorkspaceDocument;
  cardIds: string[];
}

interface SeparateRoomsFixture {
  index: LoroDoc;
  cardDocs: LoroDoc[];
  bodyUpdates: Uint8Array[];
  indexBytes: number;
  oneCardBytes: number;
  totalBytes: number;
}

function buildCurrent(count: number): CurrentFixture {
  const doc = new LoroDoc();
  const workspace = new WorkspaceDocument(doc);
  const board = workspace.ensureBoard();
  const cardIds: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const card = workspace.createCard({
      boardId: board.id,
      position: { x: (index % 50) * 260, y: Math.floor(index / 50) * 180 },
    });
    cardIds.push(card.id);
    writeParagraph(workspace.getContent(card.id), BODY_TEXT);
    writeParagraph(workspace.getTitle(card.id), `Card ${index}`);
    if (index > 0) {
      workspace.addEdge({
        boardId: board.id,
        source: cardIds[index - 1] as string,
        target: card.id,
      });
    }
  }
  doc.commit({ origin: "bench" });

  return { doc, workspace, cardIds };
}

function createCardBody(): LoroDoc {
  const doc = new LoroDoc();
  const body = doc.getMap("body");
  body.set("nodeName", "doc");
  body.ensureMergeableMap("attributes");
  writeParagraph(body, BODY_TEXT);
  doc.commit({ origin: "bench" });
  return doc;
}

function buildSeparateRooms(count: number): SeparateRoomsFixture {
  const index = new LoroDoc();
  const cards = index.getMap("cards");
  const placements = index.getMap("placements");
  const cardDocs: LoroDoc[] = [];

  for (let position = 0; position < count; position += 1) {
    const cardId = `card-${position}`;
    const summary = cards.ensureMergeableMap(cardId);
    summary.set("title", `Card ${position}`);
    summary.set("typeId", "note");
    summary.set("updatedAt", 1_700_000_000_000 + position);
    const placement = placements.ensureMergeableMap(cardId);
    placement.set("boardId", "board-1");
    placement.set("x", (position % 50) * 260);
    placement.set("y", Math.floor(position / 50) * 180);
    placement.set("z", position);
    cardDocs.push(createCardBody());
  }
  index.commit({ origin: "bench" });

  const indexBytes = encode(index).byteLength;
  const bodyUpdates = cardDocs.map(encode);
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

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const current = new Map<number, CurrentFixture>();
const rooms = new Map<number, SeparateRoomsFixture>();

function currentFixture(size: number): CurrentFixture {
  const fixture = current.get(size) ?? buildCurrent(size);
  current.set(size, fixture);
  return fixture;
}

function roomsFixture(size: number): SeparateRoomsFixture {
  const fixture = rooms.get(size) ?? buildSeparateRooms(size);
  rooms.set(size, fixture);
  return fixture;
}

describe("document boundaries", () => {
  for (const size of SIZES) {
    test(
      `${size} cards`,
      async ({ bench, expect }) => {
        const currentData = currentFixture(size);
        const roomsData = roomsFixture(size);
        const currentBytes = encode(currentData.doc).byteLength;
        const oneCardUpdate = roomsData.bodyUpdates[0] as Uint8Array;

        console.log(
          [
            `[loro-snapshot-only] ${size} cards`,
            `current=${kib(currentBytes)}`,
            `separate-index=${kib(roomsData.indexBytes)}`,
            `one-card=${kib(roomsData.oneCardBytes)}`,
            `separate-index+bodies=${kib(roomsData.totalBytes)}`,
          ].join("  "),
        );

        await bench.compare(
          bench("current: export whole workspace", BENCH_OPTIONS, () => {
            encode(currentData.doc);
          }),
          bench("current: read all cards", BENCH_OPTIONS, () => {
            currentData.workspace.listCards();
          }),
          bench("separate rooms: export index only", BENCH_OPTIONS, () => {
            encode(roomsData.index);
          }),
          bench("separate rooms: export one card doc", BENCH_OPTIONS, () => {
            encode(roomsData.cardDocs[0] as LoroDoc);
          }),
          bench("separate rooms: open one card doc", BENCH_OPTIONS, () => {
            const doc = new LoroDoc();
            doc.import(oneCardUpdate);
          }),
          BENCH_RUN_OPTIONS,
        );

        expect(currentData.workspace.listCards()).toHaveLength(size);
        expect(roomsData.cardDocs).toHaveLength(size);
      },
      BENCH_TEST_TIMEOUT_MS,
    );
  }
});
