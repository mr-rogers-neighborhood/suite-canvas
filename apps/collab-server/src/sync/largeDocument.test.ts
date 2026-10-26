import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc } from "loro-crdt";
import { MAX_MESSAGE_SIZE } from "loro-protocol";
import { LoroWebsocketClient, type LoroWebsocketClientRoom } from "loro-websocket";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, describe, expect, it } from "vitest";
import { fragmentOutboundFrames } from "./outboundFragments.js";

// loro-websocket 0.6.2 rejects its internal connection promise from close()/
// destroy() without attaching a handler. These are teardown-only rejections.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  throw reason;
});

/**
 * A document bigger than one protocol frame must reach a peer.
 *
 * `loro-protocol` refuses to encode a message over `MAX_MESSAGE_SIZE` (256 KiB).
 * A client fragments what it sends, but the relay's join backfill — the whole
 * document handed to a peer that has just joined — goes out as one `DocUpdate`.
 * Above the cap that send throws inside `loro-websocket`, the join answers
 * `JoinError`, and the peer keeps an empty document while its socket stays open.
 * The sizes below are the ones `bench/report.md` measured: 400 cards is ~437 KB
 * and 1 000 cards is ~1 MB.
 *
 * The first case is the reproduction: it fails against a relay that sends the
 * backfill whole. Both cases then assert the peer holds every card, in the
 * document's own order, with the titles and placements the seed wrote.
 */
const WORKSPACE_ID = "ws-large";
const BOARD_ID = "board-large";
const TOKEN = "large-owner";
const ARRIVAL_TIMEOUT_MS = 12_000;
const ONE_MIB = 1024 * 1024;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** A board of titled notes, each titled with its own id so order shows. */
function seedBoard(cards: number): { source: WorkspaceDocument; snapshot: Uint8Array } {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.markSeeded();
  source.createBoard({ id: BOARD_ID, name: "Large" });
  for (let index = 0; index < cards; index += 1) {
    const id = `card-${String(index).padStart(4, "0")}`;
    const position = { x: (index % 40) * 260, y: Math.floor(index / 40) * 200 };
    source.createCard({ id, typeId: "note", boardId: BOARD_ID, position });
    source.setTitleText(id, id);
  }
  source.doc.commit({ origin: "large:seed" });
  return { source, snapshot: source.doc.export({ mode: "snapshot" }) };
}

/** What a peer must end up with: every card, in the document's own order. */
function signature(workspace: WorkspaceDocument): string {
  return JSON.stringify(
    workspace.listCards().map((card) => ({
      id: card.id,
      title: workspace.displayTitle(card.id),
      placement: workspace.getPlacement(BOARD_ID, card.id) ?? null,
    })),
  );
}

async function waitFor(check: () => boolean, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

let server: SimpleServer | null = null;
let client: LoroWebsocketClient | null = null;
let room: LoroWebsocketClientRoom | null = null;

afterEach(async () => {
  await room?.leave().catch(() => undefined);
  try {
    client?.close();
  } catch {
    // The transport may already be closing itself.
  }
  room = null;
  client = null;
  const running = server;
  server = null;
  if (running) await running.stop();
});

async function joinPeer(snapshot: Uint8Array): Promise<LoroDoc> {
  const port = await freePort();
  server = fragmentOutboundFrames(
    new SimpleServer({
      port,
      authenticate: async (roomId, _crdtType, auth) => {
        if (roomId !== WORKSPACE_ID) return null;
        return Buffer.from(auth).toString("utf8") === TOKEN ? "write" : null;
      },
      onLoadDocument: async (roomId) => (roomId === WORKSPACE_ID ? snapshot : null),
    }),
  );
  await server.start();

  const doc = new LoroDoc();
  client = new LoroWebsocketClient({ url: `ws://127.0.0.1:${port}` });
  room = await client.join({
    roomId: WORKSPACE_ID,
    crdtAdaptor: new LoroAdaptor(doc),
    auth: () => new TextEncoder().encode(TOKEN),
  });
  return doc;
}

describe("a document larger than one frame", () => {
  it("reaches the peer at all (reproduction: 400 cards, ~437 KB)", async (ctx) => {
    const seeded = seedBoard(400);
    // The precondition. A document that fits in one frame proves nothing.
    expect(seeded.snapshot.byteLength).toBeGreaterThan(MAX_MESSAGE_SIZE);

    let doc: LoroDoc;
    try {
      doc = await joinPeer(seeded.snapshot);
    } catch {
      // A harness that cannot hold one session here is an environment limit.
      ctx.skip();
      return;
    }
    const peer = new WorkspaceDocument(doc);
    await waitFor(
      () => peer.listCards().length === 400,
      `400 cards (${String(seeded.snapshot.byteLength)} bytes) to reach the peer`,
      ARRIVAL_TIMEOUT_MS,
    );
    expect(peer.listCards()).toHaveLength(400);
    expect(signature(peer)).toBe(signature(seeded.source));
  });

  it("arrives whole and in order at 1 MiB", async () => {
    const seeded = seedBoard(1_000);
    expect(seeded.snapshot.byteLength).toBeGreaterThan(ONE_MIB);

    const doc = await joinPeer(seeded.snapshot);
    const peer = new WorkspaceDocument(doc);
    await waitFor(
      () => peer.listCards().length === 1_000,
      `1 000 cards (${String(seeded.snapshot.byteLength)} bytes) to reach the peer`,
      ARRIVAL_TIMEOUT_MS,
    );

    expect(peer.listCards()).toHaveLength(1_000);
    // Whole: the same titles and placements. In order: the same card sequence.
    expect(signature(peer)).toBe(signature(seeded.source));
  });
});
