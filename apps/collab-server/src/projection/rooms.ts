import { CrdtType } from "loro-protocol";
import { licenceRequired } from "../store/licence.js";
import type { DocumentStore } from "../store/persistence.js";
import type { ShareRole } from "../store/shares.js";
import type { RoomState } from "./model.js";

/**
 * Everything the relay knows about a *room*: the document key it is stored
 * under, the patched server's private room and session tables, and the idle
 * window that decides when a projection room costs more than it earns.
 */

/**
 * Store key of the Loro document in a sync room.
 *
 * Both the load and the save path go through this key: `loro-websocket` 0.6.2
 * parses its room key with `Number(...)`, so a save reports `NaN` where the join
 * reported `%LOR`. Every persisted room here holds a Loro document, so the type
 * is fixed rather than taken from the callback.
 */
export function loroDocumentKey(roomId: string): string {
  return `${CrdtType.Loro}:${roomId}`;
}

/**
 * Every key a Loro room may have been saved under, current one first. Builds
 * before `loroDocumentKey` used the CRDT type the server reported, which was
 * `loro` there and `NaN` once `loro-websocket` started parsing its key with
 * `Number(...)`; both are still read so an upgrade does not empty a workspace.
 */
export function loroDocumentKeys(roomId: string): string[] {
  return [loroDocumentKey(roomId), `loro:${roomId}`, `NaN:${roomId}`];
}

/** Stored state for a Loro room, falling back to the keys earlier builds wrote. */
export function loadLoroDocument(
  documents: Pick<DocumentStore, "load">,
  roomId: string,
): Uint8Array | null {
  for (const key of loroDocumentKeys(roomId)) {
    const state = documents.load(key);
    if (state) return state;
  }
  return null;
}

/** Scopes a projection worker keeps alive; workspace shares open the real room. */
export function deleteRoomDocuments(
  documents: Pick<DocumentStore, "delete">,
  roomId: string,
): void {
  for (const key of loroDocumentKeys(roomId)) {
    try {
      documents.delete(key);
    } catch {
      // A missing/legacy key is already gone; deletion is best-effort cleanup.
    }
  }
}

/**
 * The slice of the patched sync server `roomSessionCount` reads: the socket set
 * and the per-socket session records. `loro-websocket` keeps both private and
 * the patch adds no getter, so the shape is declared here rather than imported;
 * the same internals back `disconnectRoomWhere` in `roomSockets.ts`.
 */
export interface SyncServerSessions {
  wss?: { clients?: Iterable<unknown> };
  clients?: {
    get(socket: unknown): { rooms?: Iterable<string>; auths?: Map<string, string> } | undefined;
  };
}

/**
 * The patched sync server's room table, keyed `<roomId>:<crdtType>`. Upstream
 * keeps it private and never removes an entry, so this module reaches into it
 * the same way `roomSessionCount` reaches into the session maps.
 */
export interface SyncServerRooms {
  rooms?: Map<string, unknown>;
}

/**
 * Drops the sync server's in-memory copy of a room that no longer has a share.
 *
 * `SimpleServer` keeps one room document per room for the life of the process,
 * even after the last session leaves; for a projection room that is a full
 * document copy per dead link, which is the memory the idle sweep exists to
 * free. Only call this once the room has no sessions and its link is revoked: a
 * document dropped while somebody can still join would be rebuilt from the
 * store, which the revoke just emptied.
 */
export function forgetRoomDocument(server: unknown, roomId: string): boolean {
  const rooms = (server as SyncServerRooms | null)?.rooms;
  if (!(rooms instanceof Map)) return false;
  const names = new Set([roomId, `${roomId}:presence`, `${roomId}:cursors`]);
  let dropped = false;
  for (const key of [...rooms.keys()]) {
    const split = key.lastIndexOf(":");
    const name = split === -1 ? key : key.slice(0, split);
    if (!names.has(name)) continue;
    rooms.delete(key);
    dropped = true;
  }
  return dropped;
}

/**
 * Sessions in one share room other than the worker's own, or `null` when the
 * sync server cannot be read.
 *
 * A room key is `<roomId>:<crdtType>`; the derived presence and cursor rooms
 * count too, because a browser that only opened presence is still looking at
 * the link. One socket is one session however many rooms it joined.
 */
export function roomSessionCount(
  server: unknown,
  roomId: string,
  workerToken: string,
): number | null {
  const internals = server as SyncServerSessions | null;
  const sockets = internals?.wss?.clients;
  const clients = internals?.clients;
  if (!sockets || !clients || typeof clients.get !== "function") return null;

  const names = new Set([roomId, `${roomId}:presence`, `${roomId}:cursors`]);
  let sessions = 0;
  for (const socket of sockets) {
    const client = clients.get(socket);
    if (!client?.rooms || !client.auths) continue;
    for (const key of client.rooms) {
      const split = key.lastIndexOf(":");
      const name = split === -1 ? key : key.slice(0, split);
      if (!names.has(name)) continue;
      // The worker holds every projection room it projects; anybody else is a
      // reader the sweep must not close the room under.
      if ((client.auths.get(key) ?? "") !== workerToken) {
        sessions += 1;
        break;
      }
    }
  }
  return sessions;
}

export interface ProjectionRoomInfo {
  roomId: string;
  shareId: string;
  workspaceId: string;
  role: ShareRole;
  /** Whether the room has a projection baseline to diff its draft against. */
  hasBaseline: boolean;
  /** Whether an editor changed the draft since the last projection. */
  dirty: boolean;
}

/** One projection room the idle sweep closed, or would close on a dry run. */
export interface SweptRoom {
  roomId: string;
  shareId: string;
  workspaceId: string;
  /** Silence since the room was last refreshed or used, in milliseconds. */
  idleMs: number;
}

/**
 * What one sweep pass did. `checked` and `unknown` make a zero result readable:
 * a sweep that looked at nothing is not the same as a sweep that found nothing.
 */
export interface RoomSweepReport {
  /** Idle window applied, in hours; `0` means the sweep is switched off. */
  idleHours: number;
  dryRun: boolean;
  /** Rooms examined. */
  checked: number;
  /** Rooms whose connected sessions could not be read, so they were kept. */
  unknown: number;
  /** Rooms closed, or the rooms a dry run would close. */
  rooms: SweptRoom[];
}

/** The hosted relay's default idle window; a self-host sweeps nothing by default. */
export const DEFAULT_HOSTED_ROOM_IDLE_HOURS = 24;

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Hours a projection room may sit idle before the sweep revokes its link.
 *
 * `SUITE_ROOM_IDLE_HOURS` wins when it is a non-negative number; `0` switches
 * the sweep off. The default follows the same switch the rest of the hosted
 * behaviour does (`licenceRequired()`, i.e. `SUITE_HOSTED=1`): a relay expires
 * links nobody came back to, a self-host keeps every link warm as it always has.
 */
export function roomIdleHours(
  env: { SUITE_ROOM_IDLE_HOURS?: string | undefined } = process.env,
  hosted: boolean = licenceRequired(),
): number {
  const fallback = hosted ? DEFAULT_HOSTED_ROOM_IDLE_HOURS : 0;
  const raw = env.SUITE_ROOM_IDLE_HOURS?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Ceiling on simultaneously open projection rooms when the operator sets none.
 *
 * A projection document is a full copy of what it projects, so the measured
 * cost on this checkout is a few MiB per open room (see `docs/how-to/operate.md`,
 * "Capacity: what a projection costs"); 128 rooms keep the worst case inside a
 * small hosted instance while leaving room for far more concurrent readers than
 * a single relay usually sees. `SUITE_PROJECTION_ROOMS_MAX` tunes it.
 */
export const DEFAULT_PROJECTION_ROOM_LIMIT = 128;

/**
 * The room ceiling from `SUITE_PROJECTION_ROOMS_MAX`. Only a positive integer
 * is a limit: a missing, zero, negative or unparsable value falls back to the
 * default rather than switching the guard off, because "no ceiling" is the
 * failure this option exists to prevent.
 */
export function projectionRoomLimit(
  env: { SUITE_PROJECTION_ROOMS_MAX?: string | undefined } = process.env,
): number {
  const raw = env.SUITE_PROJECTION_ROOMS_MAX?.trim();
  if (!raw) return DEFAULT_PROJECTION_ROOM_LIMIT;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_PROJECTION_ROOM_LIMIT;
}

/**
 * What the worker holds right now, for the admin status.
 *
 * `opened` is cumulative since `start()`, so immediately after boot it *is* the
 * boot cost: before rooms became lazy this number equalled the count of stored
 * links and the process died with it.
 */

/** The operator-facing shape of one swept room. */
export function sweptRoom(room: RoomState, now: number): SweptRoom {
  return {
    roomId: room.roomId,
    shareId: room.shareId,
    workspaceId: room.workspaceId,
    idleMs: Math.max(0, now - room.lastActiveAt),
  };
}
