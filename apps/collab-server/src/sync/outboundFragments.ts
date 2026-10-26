import { randomBytes } from "node:crypto";
import type { CrdtType } from "loro-protocol";
import { MAX_MESSAGE_SIZE, MessageType } from "loro-protocol";
import type { SimpleServer } from "loro-websocket/server";

/**
 * The one send in the relay that could not fit in a frame.
 *
 * `loro-protocol` refuses to encode a message larger than `MAX_MESSAGE_SIZE`
 * (256 KiB). `loro-websocket` 0.6.2 fragments a *client's* updates
 * (`DocUpdateFragmentHeader` + `DocUpdateFragment`) and reassembles them on both
 * sides, but its server sends the join backfill — the whole document handed to a
 * peer that has just joined — as a single `DocUpdate`. `encode` throws on that
 * send, `handleJoinRequest` catches the throw and answers `JoinError`, and the
 * peer is left with an empty document on an open socket. Nothing in the relay
 * chose that ceiling; it was a frame size.
 *
 * The fix is here rather than in the dependency because the reassembly already
 * exists in the peers' shared transport: this module only has to send what a
 * peer can already reassemble. Every `DocUpdate` the server emits is inspected,
 * and one whose payloads do not fit a frame is rewritten as the protocol's own
 * fragment sequence before it reaches the socket.
 *
 * The chunk size mirrors the client's own (`240 KiB` with headroom for the
 * frame), so both ends of the transport split at the same boundary.
 */

/** Room for the magic, type, CRDT, room, batch id and length prefixes in a frame. */
const FRAME_HEADROOM_BYTES = 4 * 1024;

/**
 * Bytes of one Loro update per frame. Every frame this module emits carries at
 * most this much payload, so no encoded message can reach `MAX_MESSAGE_SIZE`.
 */
export const MAX_FRAGMENT_BYTES = Math.min(240 * 1024, MAX_MESSAGE_SIZE - FRAME_HEADROOM_BYTES);

/** The largest frame any peer will accept, from `loro-protocol`. */
export const MAX_FRAME_BYTES = MAX_MESSAGE_SIZE;

interface RoomFrame {
  crdt: CrdtType;
  roomId: string;
}

/** The `DocUpdate` a server sends; the only message type this module rewrites. */
export interface OutboundDocUpdate extends RoomFrame {
  type: typeof MessageType.DocUpdate;
  updates: Uint8Array[];
  batchId: string;
}

/** A split payload: how many fragments follow, and how many bytes they carry. */
export interface OutboundFragmentHeader extends RoomFrame {
  type: typeof MessageType.DocUpdateFragmentHeader;
  batchId: string;
  fragmentCount: number;
  totalSizeBytes: number;
}

/** One chunk of a split payload; `index` is its position in the batch. */
export interface OutboundFragment extends RoomFrame {
  type: typeof MessageType.DocUpdateFragment;
  batchId: string;
  index: number;
  fragment: Uint8Array;
}

export type OutboundFrame = OutboundDocUpdate | OutboundFragmentHeader | OutboundFragment;

/** A batch id in the protocol's `0x`-prefixed hex form. */
function newBatchId(): string {
  return `0x${randomBytes(8).toString("hex")}`;
}

/**
 * Whether a `DocUpdate` payload would exceed one frame.
 *
 * Multiple updates are also split, one frame each: their sum is what `encode`
 * measures, so two 200 KiB updates in one message failed exactly like one of
 * 400 KiB.
 */
function needsSplitting(message: OutboundDocUpdate): boolean {
  if (message.updates.length === 0) return false;
  if (message.updates.length > 1) return true;
  const only = message.updates[0] as Uint8Array;
  return only.length > MAX_FRAGMENT_BYTES;
}

/**
 * The frames one `DocUpdate` becomes, in send order.
 *
 * Pure: no socket, no clock. One update that fits is still one `DocUpdate` with
 * its original batch id, so a sender's ack correlation is unchanged; a larger
 * one becomes a header followed by its fragments, and several updates become one
 * batch each. Fragments are views over the original bytes, never copies.
 */
export function fragmentDocUpdate(message: OutboundDocUpdate): OutboundFrame[] {
  if (!needsSplitting(message)) return [message];
  const frames: OutboundFrame[] = [];
  const single = message.updates.length === 1;
  for (const update of message.updates) {
    const batchId = single ? message.batchId : newBatchId();
    if (update.length <= MAX_FRAGMENT_BYTES) {
      frames.push({
        type: MessageType.DocUpdate,
        crdt: message.crdt,
        roomId: message.roomId,
        updates: [update],
        batchId,
      });
      continue;
    }
    const fragmentCount = Math.ceil(update.length / MAX_FRAGMENT_BYTES);
    frames.push({
      type: MessageType.DocUpdateFragmentHeader,
      crdt: message.crdt,
      roomId: message.roomId,
      batchId,
      fragmentCount,
      totalSizeBytes: update.length,
    });
    for (let index = 0; index < fragmentCount; index += 1) {
      const start = index * MAX_FRAGMENT_BYTES;
      frames.push({
        type: MessageType.DocUpdateFragment,
        crdt: message.crdt,
        roomId: message.roomId,
        batchId,
        index,
        fragment: update.subarray(start, Math.min(start + MAX_FRAGMENT_BYTES, update.length)),
      });
    }
  }
  return frames;
}

/** A message the server is about to encode, narrowed to a `DocUpdate`. */
function asDocUpdate(message: unknown): OutboundDocUpdate | null {
  if (typeof message !== "object" || message === null) return null;
  const candidate = message as Partial<OutboundDocUpdate>;
  if (candidate.type !== MessageType.DocUpdate || !Array.isArray(candidate.updates)) return null;
  if (typeof candidate.roomId !== "string") return null;
  return candidate as OutboundDocUpdate;
}

/**
 * `SimpleServer.sendMessage`, as the runtime has it.
 *
 * Declared here because the class marks the method `private`: the type cannot
 * name it, but every internal send (`handleJoinRequest`, `handleDocUpdate`,
 * `handleFragment`, `sendAck`) calls `this.sendMessage`, so an own property on
 * the instance is what they all reach. `ws` and the message stay `unknown`: the
 * wrapper forwards both untouched.
 */
interface FrameSender {
  sendMessage: (ws: unknown, message: unknown) => void;
}

/** Servers this module has already wrapped, so a second call is a no-op. */
const wrapped = new WeakSet<SimpleServer>();

/**
 * Fragments every oversized `DocUpdate` this server sends.
 *
 * Returns the same server so a call site can wrap the constructor result. Every
 * other message, and every `DocUpdate` that already fits, is forwarded exactly
 * as before: this changes nothing about the protocol for a document under the
 * frame size.
 */
export function fragmentOutboundFrames(server: SimpleServer): SimpleServer {
  if (wrapped.has(server)) return server;
  wrapped.add(server);
  const internals = server as unknown as FrameSender;
  const send = internals.sendMessage.bind(server);
  internals.sendMessage = (ws: unknown, message: unknown): void => {
    const update = asDocUpdate(message);
    if (update === null) {
      send(ws, message);
      return;
    }
    for (const frame of fragmentDocUpdate(update)) send(ws, frame);
  };
  return server;
}
