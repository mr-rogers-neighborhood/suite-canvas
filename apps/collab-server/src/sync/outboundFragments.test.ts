import { encode, MessageType } from "loro-protocol";
import type { SimpleServer } from "loro-websocket/server";
import { describe, expect, it } from "vitest";
import {
  fragmentDocUpdate,
  fragmentOutboundFrames,
  MAX_FRAGMENT_BYTES,
  MAX_FRAME_BYTES,
  type OutboundDocUpdate,
  type OutboundFrame,
} from "./outboundFragments.js";

/**
 * The fragmenter's contract, without a socket.
 *
 * These are the invariants a peer depends on: every frame it is handed fits a
 * protocol message, the fragments of a batch are indexed `0…n-1` so they can be
 * put back in order, and a sequence with a fragment missing cannot be mistaken
 * for a whole document and applied.
 */
const CRDT = "%LOR" as const;
const ROOM = "ws-fragments";
const BATCH = "0x0123456789abcdef";

function update(bytes: number, fill: number): Uint8Array {
  return new Uint8Array(bytes).fill(fill);
}

function message(...updates: Uint8Array[]): OutboundDocUpdate {
  return { type: MessageType.DocUpdate, crdt: CRDT, roomId: ROOM, updates, batchId: BATCH };
}

/** The size `loro-protocol` will actually put on the wire for one frame. */
function frameBytes(frame: OutboundFrame): number {
  return encode(frame as unknown as Parameters<typeof encode>[0]).byteLength;
}

/**
 * What a peer does with a received sequence: collect by index, refuse a
 * duplicate, refuse a short batch, then concatenate in index order. This is the
 * rule `loro-websocket`'s client applies (`handleFragmentHeader`/`handleFragment`),
 * written down here so a partial sequence has something to fail against.
 */
function reassemble(frames: readonly OutboundFrame[]): Uint8Array {
  const header = frames[0];
  if (header?.type !== MessageType.DocUpdateFragmentHeader) throw new Error("no fragment header");
  const fragments = new Map<number, Uint8Array>();
  for (const frame of frames.slice(1)) {
    if (frame.type !== MessageType.DocUpdateFragment) throw new Error("not a fragment");
    if (fragments.has(frame.index)) throw new Error(`duplicate fragment ${String(frame.index)}`);
    fragments.set(frame.index, frame.fragment);
  }
  if (fragments.size !== header.fragmentCount) {
    throw new Error(
      `incomplete batch: ${String(fragments.size)} of ${String(header.fragmentCount)} fragments`,
    );
  }
  const whole = new Uint8Array(header.totalSizeBytes);
  let offset = 0;
  for (let index = 0; index < header.fragmentCount; index += 1) {
    const fragment = fragments.get(index);
    if (fragment === undefined) throw new Error(`missing fragment ${String(index)}`);
    whole.set(fragment, offset);
    offset += fragment.length;
  }
  if (offset !== header.totalSizeBytes) throw new Error("fragment sizes do not add up");
  return whole;
}

describe("fragmentDocUpdate", () => {
  it("leaves an update that fits in one frame exactly as the server built it", () => {
    const small = update(64 * 1024, 1);
    const frames = fragmentDocUpdate(message(small));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: MessageType.DocUpdate,
      batchId: BATCH,
      roomId: ROOM,
      updates: [small],
    });
    expect(frameBytes(frames[0] as OutboundFrame)).toBeLessThan(MAX_FRAME_BYTES);
  });

  it("splits a 1 MiB payload into frames no larger than the protocol allows", () => {
    const big = update(1024 * 1024, 7);
    const frames = fragmentDocUpdate(message(big));
    const header = frames[0];
    expect(header?.type).toBe(MessageType.DocUpdateFragmentHeader);
    expect(header).toMatchObject({
      batchId: BATCH,
      totalSizeBytes: big.byteLength,
      fragmentCount: Math.ceil(big.byteLength / MAX_FRAGMENT_BYTES),
    });
    expect(frames).toHaveLength(1 + Math.ceil(big.byteLength / MAX_FRAGMENT_BYTES));
    for (const frame of frames) expect(frameBytes(frame)).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  it("reassembles byte-for-byte, in order, with no gap in the indices", () => {
    const big = update(1024 * 1024, 3);
    const frames = fragmentDocUpdate(message(big));
    const header = frames[0];
    if (header?.type !== MessageType.DocUpdateFragmentHeader) throw new Error("no header");
    const indices = frames.slice(1).map((frame) => (frame as { index: number }).index);
    expect(indices).toEqual(Array.from({ length: header.fragmentCount }, (_, index) => index));
    expect(reassemble(frames)).toEqual(big);
  });

  it("refuses a partial sequence rather than applying it", () => {
    const big = update(1024 * 1024, 5);
    const frames = fragmentDocUpdate(message(big));
    const dropped = [...frames.slice(0, -1)];
    expect(() => reassemble(dropped)).toThrow(/incomplete batch/u);

    const first = frames[1] as Extract<OutboundFrame, { index: number }>;
    const duplicated = [...frames, first];
    expect(() => reassemble(duplicated)).toThrow(/duplicate fragment/u);
  });

  it("sends each update of a multi-update message in its own batch", () => {
    const frames = fragmentDocUpdate(message(update(200 * 1024, 1), update(200 * 1024, 2)));
    expect(frames).toHaveLength(2);
    const [first, second] = frames as [OutboundDocUpdate, OutboundDocUpdate];
    expect(first.batchId).not.toBe(second.batchId);
    for (const frame of frames) expect(frameBytes(frame)).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });
});

describe("fragmentOutboundFrames", () => {
  it("forwards every message that is not an oversized DocUpdate untouched", () => {
    const sent: unknown[] = [];
    const stub = {
      sendMessage: (_ws: unknown, message: unknown) => sent.push(message),
    } as unknown as SimpleServer;
    fragmentOutboundFrames(stub);
    const sender = stub as unknown as { sendMessage: (ws: unknown, message: unknown) => void };
    const ack = { type: MessageType.Ack, crdt: CRDT, roomId: ROOM, refId: BATCH, status: 0 };
    sender.sendMessage({}, ack);
    expect(sent).toEqual([ack]);
  });

  it("rewrites an oversized DocUpdate into a fragment sequence", () => {
    const sent: OutboundFrame[] = [];
    const stub = {
      sendMessage: (_ws: unknown, message: unknown) => sent.push(message as OutboundFrame),
    } as unknown as SimpleServer;
    fragmentOutboundFrames(stub);
    const sender = stub as unknown as { sendMessage: (ws: unknown, message: unknown) => void };
    const big = update(1024 * 1024, 9);
    sender.sendMessage({}, message(big));
    expect(sent[0]?.type).toBe(MessageType.DocUpdateFragmentHeader);
    expect(reassemble(sent)).toEqual(big);
  });

  it("wraps a server once, so a second call cannot fragment twice", () => {
    const sent: unknown[] = [];
    const stub = {
      sendMessage: (_ws: unknown, message: unknown) => sent.push(message),
    } as unknown as SimpleServer;
    fragmentOutboundFrames(stub);
    fragmentOutboundFrames(stub);
    const sender = stub as unknown as { sendMessage: (ws: unknown, message: unknown) => void };
    const small = message(update(1024, 1));
    sender.sendMessage({}, small);
    expect(sent).toEqual([small]);
  });
});
