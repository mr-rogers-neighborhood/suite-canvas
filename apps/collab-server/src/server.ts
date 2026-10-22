import { createServer } from "node:http";
import { SimpleServer } from "loro-websocket/server";
import { authorize, resolveWorkerTokens } from "./auth.js";
import { handleShareRequest } from "./http.js";
import { createDocumentStore } from "./persistence.js";
import {
  loadLoroDocument,
  loroDocumentKey,
  loroDocumentKeys,
  ProjectionWorker,
} from "./projectionWorker.js";
import {
  disconnectAuthSessions,
  disconnectProjectionViewers,
  disconnectWorkspaceShares,
} from "./roomSockets.js";
import { createShareStore, SHARE_ROOM_PREFIX, type Share } from "./shares.js";
import { handleWorkspaceRequest } from "./workspaceHttp.js";
import { createWorkspaceRegistry } from "./workspaces.js";

// loro-websocket 0.6.2 can reject its internal connection promise while a
// client is closing. Only that teardown case is ignored; other unhandled
// rejections are logged so they stay visible.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  console.error("[server] unhandled rejection", reason);
});

const port = Number(process.env.PORT ?? 1234);
const healthPort = Number(process.env.HEALTH_PORT ?? 1235);
const store = createDocumentStore(process.env.SUITE_DB ?? "suite.documents.sqlite");
// Shares live in their own file so token writes never contend with the
// document store's save interval.
const shares = createShareStore(process.env.SUITE_SHARES_DB ?? "suite.shares.sqlite");
// Owner key hashes live beside the share hashes: both are credentials, neither
// is document state, so they stay out of the document store's save loop.
const workspaces = createWorkspaceRegistry(
  process.env.SUITE_WORKSPACES_DB ?? "suite.workspaces.sqlite",
);
const { projectionToken, sourceToken } = resolveWorkerTokens();

// Board and card shares read a projection room kept up to date by this worker.
const worker = new ProjectionWorker({
  url: `ws://localhost:${port}`,
  projectionToken,
  sourceToken,
  documents: store,
  shares,
});

const isWorkspaceRoom = (roomId: string): boolean => !roomId.startsWith(SHARE_ROOM_PREFIX);

const server = new SimpleServer({
  port,
  // Coalesce writes so an active editing session does not hammer SQLite.
  saveInterval: 2000,

  async onLoadDocument(roomId) {
    // Falls back to the keys earlier builds wrote, so an upgrade keeps its data.
    return loadLoroDocument(store, roomId);
  },

  async onSaveDocument(roomId, _crdtType, data) {
    // Ephemeral rooms never get here: their descriptor has `shouldPersist: false`.
    // `crdtType` is unreliable anyway (see `loroDocumentKey`).
    store.save(loroDocumentKey(roomId), data);
    // A saved workspace is a new projection source; share rooms save their own
    // projected output and must not feed back into the worker.
    if (isWorkspaceRoom(roomId)) void worker.schedule(roomId);
  },

  authenticate(roomId, _crdtType, auth) {
    return authorize(roomId, auth, { shares, workspaces, projectionToken, sourceToken });
  },
});

await server.start();
await worker.start();

function removeShare(share: Share): void {
  if (share.roomId !== null && share.scope !== "workspace") {
    // The worker joins projection rooms with the projection token; every other
    // session in the room is the revoked link itself.
    disconnectProjectionViewers(server, share.roomId, projectionToken);
    for (const key of loroDocumentKeys(share.roomId)) store.delete(key);
  } else {
    // A workspace share lives in the owner's room: close the share credential
    // that was just revoked and leave the owner and the publish worker alone.
    disconnectWorkspaceShares(server, share.workspaceId, { sourceToken, workspaces, shares });
  }
  void worker.schedule(share.workspaceId, { immediate: true });
}

const expirySweep = setInterval(() => {
  for (const share of shares.listExpired()) {
    const revoked = shares.revoke(share.id) ?? share;
    removeShare(revoked);
  }
}, 60_000);
expirySweep.unref();

const health = createServer((request, response) => {
  void handleShareRequest(request, response, shares, workspaces, {
    onSharesChanged: (workspaceId) => {
      void worker.schedule(workspaceId, { immediate: true });
    },
    onShareRemoved: removeShare,
    publish: (share, version, overwrite) => worker.publish(share, version, overwrite),
    reload: (share) => worker.reload(share),
    status: (share) => worker.status(share),
  })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      return handleWorkspaceRequest(request, response, workspaces, {
        onRotated: (_workspaceId, previousOwnerKey) => {
          // Rotation already replaced the hash, so the old key authenticates
          // nothing; drop the sessions that still hold it.
          disconnectAuthSessions(server, previousOwnerKey);
        },
      });
    })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
        return;
      }
      response.writeHead(404);
      response.end();
    })
    .catch(() => {
      if (response.writableEnded) return;
      response.writeHead(500);
      response.end();
    });
});
health.listen(healthPort);
console.log(`Loro sync server ready on ws://localhost:${port} (health :${healthPort})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void worker
      .stop()
      .catch(() => undefined)
      .then(() => server.stop())
      .catch(() => undefined)
      .finally(() => {
        clearInterval(expirySweep);
        health.close();
        store.close();
        shares.close();
        workspaces.close();
        process.exit(0);
      });
  });
}
