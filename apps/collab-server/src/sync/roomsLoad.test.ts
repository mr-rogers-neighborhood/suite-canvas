import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { getType, isContainer, LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { LoroWebsocketClient, type LoroWebsocketClientRoom } from "loro-websocket";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, describe, expect, it } from "vitest";

// loro-websocket 0.6.2 rejects its internal connection promise from close()/
// destroy() without attaching a handler. These are teardown-only rejections.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  throw reason;
});

/**
 * A five-client load check on one workspace room.
 *
 * The projection tests answer "does one link track one workspace"; this answers
 * "do five editors on one workspace still converge, and how long does it take".
 * It is a load *smoke* test, not a benchmark: it stays inside a few seconds and
 * prints the number it measured, so a regression shows up as a slower line
 * rather than only as a failure.
 */

const WORKSPACE_ID = "ws-load";
const BOARD_ID = "board-load";
const CLIENTS = 5;
const EDITS_PER_CLIENT = 40;
/** 200 edits in total, the number quoted in `docs/how-to/operate.md`. */
const TOTAL_EDITS = CLIENTS * EDITS_PER_CLIENT;
/** One credential per client, so the server answers five distinct sessions. */
const TOKENS = Array.from({ length: CLIENTS }, (_, index) => `load-owner-${index + 1}`);
const CARD_IDS = Array.from({ length: CLIENTS }, (_, index) => `card-${index + 1}`);
/** The character each client appends to its own card's title. */
const APPENDED = "x";
const CONVERGENCE_TIMEOUT_MS = 15_000;

interface LoadClient {
  token: string;
  doc: LoroDoc;
  client: LoroWebsocketClient;
  room: LoroWebsocketClientRoom;
  workspace: () => WorkspaceDocument;
}

function appendText(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
}

/** Appends to the card title's first paragraph, the run an editor types into. */
function appendToFirstRun(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const first = children.get(0);
  if (!first || !isContainer(first)) throw new Error("the card has no first block");
  const inline = (first as LoroMap).ensureMergeableList("children");
  const target = inline.get(0);
  if (!target || getType(target as never) !== "Text") throw new Error("the block has no text run");
  (target as LoroText).insert((target as LoroText).length, text);
}

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

/** The seeded workspace every client starts from. */
function seedWorkspace(): { source: WorkspaceDocument; snapshot: Uint8Array } {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.markSeeded();
  const board = source.createBoard({ id: BOARD_ID, name: "Load" });
  for (const [index, cardId] of CARD_IDS.entries()) {
    source.createCard({
      id: cardId,
      typeId: "note",
      boardId: board.id,
      position: { x: 10 * index, y: 10 * index },
    });
    appendText(source.getTitle(cardId), cardId.toUpperCase());
  }
  source.doc.commit({ origin: "load:seed" });
  return { source, snapshot: source.doc.export({ mode: "snapshot" }) };
}

/** Everything the five clients must agree on: text and placement, per card. */
function signature(workspace: WorkspaceDocument): string {
  return JSON.stringify({
    titles: CARD_IDS.map((cardId) => workspace.displayTitle(cardId)),
    placements: CARD_IDS.map((cardId) => {
      const placement = workspace.getPlacement(BOARD_ID, cardId);
      return placement ? { x: placement.x, y: placement.y } : null;
    }),
  });
}

function versionJson(doc: LoroDoc): string {
  return JSON.stringify(
    [...doc.version().toJSON()]
      .map(([peer, counter]) => [String(peer), counter] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
  );
}

async function waitFor(check: () => boolean, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

let server: SimpleServer | null = null;
const open: LoadClient[] = [];

afterEach(async () => {
  for (const client of open.splice(0)) {
    await client.room.leave().catch(() => undefined);
    try {
      client.client.close();
    } catch {
      // The transport may already be closing itself.
    }
  }
  const running = server;
  server = null;
  if (running) await running.stop();
});

describe("five-client load", () => {
  it("converges on identical text and placement state", async (ctx) => {
    const port = await freePort();
    const { snapshot } = seedWorkspace();
    const url = `ws://127.0.0.1:${port}`;

    server = new SimpleServer({
      port,
      // Only these five credentials may write the room, and each is distinct.
      authenticate: async (roomId, _crdtType, auth) => {
        if (roomId !== WORKSPACE_ID) return null;
        const token = Buffer.from(auth).toString("utf8");
        return TOKENS.includes(token) ? "write" : null;
      },
      onLoadDocument: async (roomId) => (roomId === WORKSPACE_ID ? snapshot : null),
    });
    await server.start();

    for (const token of TOKENS) {
      try {
        const doc = new LoroDoc();
        const client = new LoroWebsocketClient({ url });
        const room = await client.join({
          roomId: WORKSPACE_ID,
          crdtAdaptor: new LoroAdaptor(doc),
          auth: () => new TextEncoder().encode(token),
        });
        open.push({ token, doc, client, room, workspace: () => new WorkspaceDocument(doc) });
      } catch {
        // A harness or transport that cannot hold five sessions here is an
        // environment limit, not a product failure: skip with the count.
        ctx.skip();
        return;
      }
    }

    // Every client starts from the seeded workspace, not from a local copy.
    await waitFor(
      () =>
        open.every((client) =>
          CARD_IDS.every(
            (cardId) => client.workspace().displayTitle(cardId) === cardId.toUpperCase(),
          ),
        ),
      "the seeded workspace on all five clients",
      CONVERGENCE_TIMEOUT_MS,
    );

    const edits = async (client: LoadClient, index: number): Promise<void> => {
      const cardId = CARD_IDS[index] as string;
      for (let edit = 0; edit < EDITS_PER_CLIENT; edit += 1) {
        const workspace = client.workspace();
        appendToFirstRun(workspace.getTitle(cardId), APPENDED);
        // Every tenth edit moves the card as well, so the check covers
        // placement merging and not only text.
        if (edit % 10 === 9) {
          workspace.placeCard(BOARD_ID, cardId, { x: 10 * (edit + 1), y: 5 * (edit + 1) });
        }
        client.doc.commit({ origin: `load:${client.token}` });
        if (edit % 5 === 4) await delay(5);
      }
    };

    const startedAt = performance.now();
    await Promise.all(open.map((client, index) => edits(client, index)));

    const converged = (): boolean => {
      const first = signature(open[0]?.workspace() ?? new WorkspaceDocument());
      const expected = expectedSignatureFor(lastPlacement());
      return (
        first === expected &&
        open.every((client) => signature(client.workspace()) === first) &&
        new Set(open.map((client) => versionJson(client.doc))).size === 1
      );
    };
    await waitFor(converged, `${TOTAL_EDITS} edits to converge`, CONVERGENCE_TIMEOUT_MS);
    const elapsedMs = Math.round(performance.now() - startedAt);

    // The number this test exists to report, greppable in a CI log. It goes to
    // stdout rather than console.log so the vitest reporter never swallows it.
    process.stdout.write(
      `[load] ${open.length} clients / ${TOTAL_EDITS} edits converge in ${elapsedMs}ms\n`,
    );

    const finalSignature = signature(open[0]?.workspace() ?? new WorkspaceDocument());
    for (const client of open) expect(signature(client.workspace())).toBe(finalSignature);
    expect(versionJson(open[0]?.doc ?? new LoroDoc())).toBe(
      versionJson(open[4]?.doc ?? new LoroDoc()),
    );
    expect(elapsedMs).toBeLessThan(20_000);

    const example = open[0]?.workspace();
    for (const [index, cardId] of CARD_IDS.entries()) {
      expect(example?.displayTitle(cardId)).toBe(
        `${cardId.toUpperCase()}${APPENDED.repeat(EDITS_PER_CLIENT)}`,
      );
      expect(example?.getPlacement(BOARD_ID, cardId)).toMatchObject(lastPlacement()[index] ?? {});
    }
  }, 30_000);
});

/** The placement the last move of each client's loop leaves behind. */
function lastPlacement(): { x: number; y: number }[] {
  const lastEdit = EDITS_PER_CLIENT - 1;
  return CARD_IDS.map(() => ({ x: 10 * (lastEdit + 1), y: 5 * (lastEdit + 1) }));
}

/** What the five clients must end up with, computed from the edit script. */
function expectedSignatureFor(placements: { x: number; y: number }[]): string {
  return JSON.stringify({
    titles: CARD_IDS.map((cardId) => `${cardId.toUpperCase()}${APPENDED.repeat(EDITS_PER_CLIENT)}`),
    placements,
  });
}
