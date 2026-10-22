import type { SimpleServer } from "loro-websocket/server";
import type { ShareStore } from "./shares.js";
import type { WorkspaceRegistry } from "./workspaces.js";

/**
 * The slice of `SimpleServer` these helpers need. It is provided by the pinned
 * `loro-websocket@0.6.2` patch (`patches/loro-websocket@0.6.2.patch`): the
 * server records the auth credential used for every joined room and exposes
 * `disconnectRoomWhere` and `disconnectAuth`. When upstream ships an equivalent
 * API, drop the patch and keep this file.
 */
export type KickServer = Pick<SimpleServer, "disconnectRoomWhere" | "disconnectAuth">;

/**
 * Closes the viewers of a projection room, keeping the worker that builds it.
 * A projection room admits two credentials: the projection token the worker
 * joins with, and the link's own share token. Every other session in the room
 * is a browser that just lost access.
 */
export function disconnectProjectionViewers(
  server: KickServer,
  roomId: string,
  projectionToken: string,
): number {
  return server.disconnectRoomWhere(roomId, (auth) => auth !== projectionToken);
}

export interface WorkspaceShareKickDeps {
  /** Token the publish worker joins workspace rooms with; it stays connected. */
  sourceToken: string;
  workspaces: Pick<WorkspaceRegistry, "verify">;
  shares: Pick<ShareStore, "resolve" | "isShareToken">;
}

/**
 * Closes the share viewers of a workspace room. The owner key and the source
 * worker stay connected, and so does a viewer of another link that is still
 * active: only credentials that no longer authenticate are kicked.
 */
export function disconnectWorkspaceShares(
  server: KickServer,
  workspaceId: string,
  deps: WorkspaceShareKickDeps,
): number {
  return server.disconnectRoomWhere(workspaceId, (auth) => {
    if (auth.length === 0 || auth === deps.sourceToken) return false;
    try {
      if (deps.workspaces.verify(workspaceId, auth)) return false;
    } catch {
      // A malformed credential never owns a workspace.
    }
    return deps.shares.isShareToken(auth) && deps.shares.resolve(auth) === null;
  });
}

/**
 * Closes every session authenticated with a credential that is no longer valid,
 * such as the previous owner key after a rotation.
 */
export function disconnectAuthSessions(server: KickServer, auth: string): number {
  return server.disconnectAuth(auth);
}
