import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc } from "loro-crdt";
import { CrdtType, decode, encode, MessageType, UpdateStatusCode } from "loro-protocol";
import { LoroWebsocketClient, type LoroWebsocketClientRoom } from "loro-websocket";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  fragmentDocUpdate,
  fragmentOutboundFrames,
  type OutboundFrame,
} from "./outboundFragments.js";

// loro-websocket 0.6.2 rejects its internal connection promise from close()/
// destroy() without attaching a handler. These are teardown-only rejections.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  throw reason;
});

/**
 * A batch of fragments is either complete or it is not applied.
 *
 * The relay applies a reassembled payload only when every fragment of the batch
 * has arrived, and forwards nothing until it has. This test plays that from the
 * far side: a raw socket sends the exact frames `fragmentDocUpdate` produces for
 * a real 300-card snapshot, minus the last one, and then sends the missing
 * fragment. The peer must hold nothing in between — a partial document is never
 * applied — and everything after.
 *
 * It also proves the frames this repository emits are the frames a peer accepts,
 * not merely what one unit test can decode.
 */
const WORKSPACE_ID = "ws-partial";
const BOARD_ID = "board-partial";
const TOKEN = "partial-owner";
const CARDS = 300;
const ARRIVAL_TIMEOUT_MS = 10_000;
const SETTLE_MS = 800;

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

/** A snapshot over one chunk, so the frame sequence really is fragmented. */
function seedSnapshot(): Uint8Array {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.markSeeded();
  source.createBoard({ id: BOARD_ID, name: "Partial" });
  for (let index = 0; index < CARDS; index += 1) {
    const id = `card-${String(index).padStart(4, "0")}`;
    source.createCard({
      id,
      typeId: "note",
      boardId: BOARD_ID,
      position: { x: (index % 40) * 260, y: Math.floor(index / 40) * 200 },
    });
    source.setTitleText(id, id);
  }
  source.doc.commit({ origin: "partial:seed" });
  return source.doc.export({ mode: "snapshot" });
}

async function waitFor(check: () => boolean, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** A socket that speaks just enough of the protocol to send and read frames. */
interface RawPeer {
  send: (frame: OutboundFrame) => void;
  acks: number[];
  close: () => void;
}

async function openRawPeer(url: string): Promise<RawPeer> {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const acks: number[] = [];
  let joined = false;
  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data === "string") return;
    const message = decode(new Uint8Array(event.data as ArrayBuffer));
    if (message.type === MessageType.JoinResponseOk) joined = true;
    if (message.type === MessageType.Ack) acks.push(message.status);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("raw peer could not connect")));
  });
  socket.send(
    encode({
      type: MessageType.JoinRequest,
      crdt: CrdtType.Loro,
      roomId: WORKSPACE_ID,
      auth: new TextEncoder().encode(TOKEN),
      version: new Uint8Array(),
    }),
  );
  await waitFor(() => joined, "the raw peer to join the room", ARRIVAL_TIMEOUT_MS);
  return {
    send: (frame) => socket.send(encode(frame as unknown as Parameters<typeof encode>[0])),
    acks,
    close: () => socket.close(),
  };
}

let server: SimpleServer | null = null;
let client: LoroWebsocketClient | null = null;
let room: LoroWebsocketClientRoom | null = null;
let raw: RawPeer | null = null;

afterEach(async () => {
  raw?.close();
  raw = null;
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

describe("a partial fragment sequence", () => {
  it("is neither acknowledged nor applied until the last fragment arrives", async (ctx) => {
    const snapshot = seedSnapshot();
    const frames = fragmentDocUpdate({
      type: MessageType.DocUpdate,
      crdt: CrdtType.Loro,
      roomId: WORKSPACE_ID,
      updates: [snapshot],
      batchId: "0x0011223344556677",
    });
    // The precondition: this batch really is several frames, so "partial" means
    // something.
    const header = frames[0];
    if (header?.type !== MessageType.DocUpdateFragmentHeader) throw new Error("not fragmented");
    expect(header.fragmentCount).toBeGreaterThan(1);
    expect(frames).toHaveLength(header.fragmentCount + 1);

    const port = await freePort();
    server = fragmentOutboundFrames(
      new SimpleServer({
        port,
        authenticate: async (roomId, _crdtType, auth) => {
          if (roomId !== WORKSPACE_ID) return null;
          return Buffer.from(auth).toString("utf8") === TOKEN ? "write" : null;
        },
        onLoadDocument: async () => null,
      }),
    );
    await server.start();
    const url = `ws://127.0.0.1:${port}`;

    const doc = new LoroDoc();
    client = new LoroWebsocketClient({ url });
    try {
      room = await client.join({
        roomId: WORKSPACE_ID,
        crdtAdaptor: new LoroAdaptor(doc),
        auth: () => new TextEncoder().encode(TOKEN),
      });
      raw = await openRawPeer(url);
    } catch {
      // A harness that cannot hold these two sessions is an environment limit.
      ctx.skip();
      return;
    }

    const peer = (): WorkspaceDocument => new WorkspaceDocument(doc);
    for (const frame of frames.slice(0, -1)) raw.send(frame as OutboundFrame);
    await delay(SETTLE_MS);

    // Nothing applied, nothing acknowledged: a short batch is not a document.
    expect(peer().listCards()).toHaveLength(0);
    expect(raw.acks).not.toContain(UpdateStatusCode.Ok);

    const last = frames.at(-1);
    if (last === undefined) throw new Error("the batch has no frames");
    raw.send(last);
    await waitFor(
      () => peer().listCards().length === CARDS,
      `${String(CARDS)} cards after the missing fragment`,
      ARRIVAL_TIMEOUT_MS,
    );
    expect(peer().listCards()).toHaveLength(CARDS);
    expect(raw.acks).toContain(UpdateStatusCode.Ok);
  });
});
