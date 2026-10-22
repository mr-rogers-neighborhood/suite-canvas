import type { SimpleServer } from "loro-websocket/server";

interface SocketLike {
  readyState: number;
  close: (code?: number, reason?: string) => void;
}

interface ClientLike {
  rooms: Set<string>;
}

interface ServerRuntime {
  wss?: { clients?: Set<SocketLike> };
  clients?: WeakMap<SocketLike, ClientLike>;
}

const CLOSE_REVOKED = 1008;

/**
 * The projection worker uses one socket for every room and the source worker
 * uses one for the workspace. Closing either would drop every projection, so a
 * socket with more than the browser's three room keys (document, presence,
 * cursors), or a lone workspace room, is the worker. A browser tab holds one
 * base room plus its ephemeral presence/cursor rooms.
 */
function isWorkerSocket(client: ClientLike, _roomIds: readonly string[]): boolean {
  // The worker joins only the document room (one room); a browser tab joins the
  // document plus presence and cursors. A projection worker that holds several
  // shares is identifiable by its several share base rooms.
  if (client.rooms.size <= 1) return true;
  const shareBases = new Set(
    [...client.rooms].filter((key) => key.startsWith("share-")).map((key) => key.split(":")[0]),
  );
  return shareBases.size > 1;
}

/**
 * `loro-websocket` keeps its socket and room maps private and has no public
 * kick API. We read them through a narrow runtime adapter so revoking a link or
 * rotating an owner key invalidates connections that were already open. The
 * adapter is covered by tests; keep the `loro-websocket` version pinned.
 */
export function disconnectRooms(server: SimpleServer, roomIds: readonly string[]): number {
  const wanted = [...new Set(roomIds.filter((roomId) => roomId.length > 0))];
  if (wanted.length === 0) return 0;

  const runtime = server as unknown as ServerRuntime;
  const sockets = runtime.wss?.clients;
  const clients = runtime.clients;
  if (!sockets || !clients) return 0;

  let closed = 0;
  for (const socket of sockets) {
    const client = clients.get(socket);
    if (!client || isWorkerSocket(client, wanted)) continue;
    const matches = [...client.rooms].some((key) =>
      wanted.some((roomId) => key === roomId || key.startsWith(`${roomId}:`)),
    );
    if (!matches) continue;
    try {
      socket.close(CLOSE_REVOKED, "Access revoked");
      closed += 1;
    } catch {
      // The socket is already closing; nothing else to do.
    }
  }
  return closed;
}
