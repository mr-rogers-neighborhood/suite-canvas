import { createServer } from "node:http";
import { SimpleServer } from "loro-websocket/server";
import { handleAdminRequest } from "./adminHttp.js";
import { handleAttachmentRequest } from "./attachmentHttp.js";
import { authorize, resolveWorkerTokens } from "./auth.js";
import { validateConfig } from "./config.js";
import { handleShareRequest } from "./http.js";
import { licenceRequired } from "./licence.js";
import {
  createQuotaService,
  createShareQuotaGuard,
  limitsProblem,
  type QuotaOptions,
  readLimitOverrides,
  resolveLimits,
} from "./limits.js";
import { createLogger, createRequestLogger } from "./logging.js";
import { metrics as processMetrics } from "./metrics.js";
import { configureSqlite, createDocumentStore } from "./persistence.js";
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
import { createSettingsStore } from "./settings.js";
import { createShareStore, SHARE_ROOM_PREFIX, type Share, type ShareStore } from "./shares.js";
import {
  defaultLicenceClaimStore,
  handleWorkspaceRequest,
  type WorkspaceQuotaGate,
} from "./workspaceHttp.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

const logger = createLogger().child({ component: "server" });

// Everything the process needs is read and type-checked before a socket is
// bound or a database is opened. A bad value exits with one line per problem, so
// a supervisor restarts it loudly instead of serving a half-configured instance.
const boot = validateConfig(process.env);
if (!boot.ok) {
  for (const problem of boot.problems) {
    logger.error("invalid configuration", {
      variable: problem.variable,
      problem: problem.message,
    });
  }
  logger.error("refusing to start", {
    version: boot.config.version,
    problems: boot.problems.length,
  });
  process.exit(1);
}
const config = boot.config;

// loro-websocket 0.6.2 can reject its internal connection promise while a
// client is closing. Only that teardown case is ignored; other unhandled
// rejections are logged so they stay visible.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  logger.error("unhandled rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

const port = config.ports.ws;
const healthPort = config.ports.health;
const paths = {
  documents: config.paths.documents,
  shares: config.paths.shares,
  workspaces: config.paths.workspaces,
};
// The document store opens its own connection, but the share and workspace
// stores do not set a journal mode. WAL is a property of the file, so setting
// it here covers all three without touching those modules.
for (const name of ["shares", "workspaces"] as const) {
  try {
    const mode = configureSqlite(paths[name]);
    if (mode.toLowerCase() !== "wal") {
      logger.warn("journal mode was not applied", { db: name, journalMode: mode });
    }
  } catch (error) {
    logger.error("could not configure SQLite", {
      db: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
const store = createDocumentStore(paths.documents);
// Shares live in their own file so token writes never contend with the
// document store's save interval.
const shares = createShareStore(paths.shares);
// Owner key hashes live beside the share hashes: both are credentials, neither
// is document state, so they stay out of the document store's save loop.
const workspaces = createWorkspaceRegistry(paths.workspaces);

// Runtime limit overrides live in a tiny key/value store of their own, so
// changing a quota never rewrites a document or a share row. Without
// `SUITE_SETTINGS_DB` the store is in memory and overrides last one process.
const settings = createSettingsStore();
const currentLimits = (): ReturnType<typeof resolveLimits> =>
  resolveLimits(process.env, readLimitOverrides(settings));
const bootLimits = currentLimits();
const bootProblem = limitsProblem(bootLimits.limits) ?? bootLimits.problems[0] ?? null;
if (bootProblem !== null) {
  logger.error("invalid limits; refusing to start", { problem: bootProblem });
  process.exit(1);
}

// The hosted relay records a licence per workspace; its quotas are the tighter
// of the signed token and the instance limits. A self-host never opens it.
const licenceClaims = licenceRequired() ? defaultLicenceClaimStore() : null;
const quotaOptions: QuotaOptions = {
  documents: store,
  shares,
  size: () => store.size(),
  limits: () => currentLimits().limits,
  logger,
};
if (licenceClaims !== null) {
  quotaOptions.licenceBytes = (workspaceId) => {
    const bytes = licenceClaims.get(workspaceId)?.quota.documentBytes ?? 0;
    // Zero is how a row written before `quota_json` reads; it adds no budget.
    return Number.isFinite(bytes) && bytes > 0 ? { documentBytes: bytes } : null;
  };
}
const quotas = createQuotaService(quotaOptions);
// Only creation is guarded: a save, a resolve and a revoke never consult a quota.
const guardedShares = createShareQuotaGuard(shares, quotas);
// Counting sits outside the guard, so a refused creation (quota, cap) is not a
// creation and the counter cannot drift from the rows the store accepted.
const countedShares: ShareStore = {
  ...guardedShares,
  create: (input) => {
    const created = guardedShares.create(input);
    processMetrics.shareCreated();
    return created;
  },
};
// Same idea for claims: one attempt is one answer from the registry, whatever
// the caller does with it. The outcome, never the workspace id, is the label.
const countedWorkspaces: WorkspaceRegistry = {
  ...workspaces,
  claimOrVerify: (workspaceId, ownerKey) => {
    const result = workspaces.claimOrVerify(workspaceId, ownerKey);
    processMetrics.claimAttempted(result);
    return result;
  },
};
const quotaGate: WorkspaceQuotaGate = { quotas };
if (licenceClaims !== null) {
  quotaGate.licenceWorkspaces = (licenceId) => licenceClaims.countForLicence(licenceId);
}
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

/**
 * Every rebuild the server asks for goes through here, so the counter and the
 * failure counter describe the same call sites. `schedule` coalesces saves, so
 * this counts requested passes, not runs inside the worker.
 */
function scheduleProjection(workspaceId: string, options: { immediate?: boolean } = {}): void {
  processMetrics.projectionRebuilt();
  void worker.schedule(workspaceId, options).catch((error: unknown) => {
    processMetrics.projectionFailed();
    logger.warn("projection rebuild failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/** Rooms the sync server holds; upstream keeps them private, so read defensively. */
function socketRoomCount(): number | null {
  const rooms = (server as unknown as { rooms?: unknown }).rooms;
  return rooms instanceof Map ? rooms.size : null;
}

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
    if (isWorkspaceRoom(roomId)) scheduleProjection(roomId);
  },

  authenticate(roomId, _crdtType, auth) {
    return authorize(roomId, auth, {
      shares: countedShares,
      workspaces: countedWorkspaces,
      projectionToken,
      sourceToken,
    });
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
    disconnectWorkspaceShares(server, share.workspaceId, {
      sourceToken,
      workspaces: countedWorkspaces,
      shares: countedShares,
    });
  }
  scheduleProjection(share.workspaceId, { immediate: true });
}

const expirySweep = setInterval(() => {
  for (const share of shares.listExpired()) {
    const revoked = shares.revoke(share.id) ?? share;
    removeShare(revoked);
  }
}, 60_000);
expirySweep.unref();

const health = createServer((request, response) => {
  // One line per request, written when the response finishes. The target is
  // redacted first, so a share token or key never reaches stdout.
  const requestLog = createRequestLogger(request, response, { logger });
  // The narrowest point that sees every HTTP answer, including the ones the
  // share and workspace handlers write: one counter per status class, and a
  // 429 counted again as a rate-limit rejection.
  response.on("finish", () => processMetrics.observeHttp(response.statusCode));

  void handleShareRequest(request, response, countedShares, countedWorkspaces, {
    onSharesChanged: (workspaceId) => {
      scheduleProjection(workspaceId, { immediate: true });
    },
    onShareRemoved: removeShare,
    publish: async (share, version, overwrite) => {
      processMetrics.publishAttempted();
      const result = await worker.publish(share, version, overwrite);
      if (!result.ok && result.conflicts.length > 0) processMetrics.publishConflict();
      return result;
    },
    reload: (share) => worker.reload(share),
    status: (share) => worker.status(share),
  })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      return handleWorkspaceRequest(request, response, countedWorkspaces, {
        onRotated: (_workspaceId, previousOwnerKey) => {
          // Rotation already replaced the hash, so the old key authenticates
          // nothing; drop the sessions that still hold it.
          disconnectAuthSessions(server, previousOwnerKey);
        },
        quota: quotaGate,
      });
    })
    // Attachments are bytes beside the document, referenced by id from a card
    // body; the cap is the live resolved one, so an override applies at once.
    .then((handled) => {
      if (handled || response.writableEnded) return;
      return handleAttachmentRequest(request, response, countedWorkspaces, {
        cap: () => currentLimits().limits.attachmentBytesPerWorkspace,
      });
    })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      return handleAdminRequest(request, response, {
        documents: store,
        shares: countedShares,
        workspaces: countedWorkspaces,
        paths,
        limits: currentLimits,
        settings,
        quotas,
        metrics: processMetrics,
        diskBytes: () => quotas.disk(),
        projectionRooms: () => worker.projectionRooms(),
        disconnectRoom: (roomId) => server.disconnectRoomWhere(roomId, () => true),
        onShareRemoved: removeShare,
        onSharesChanged: (workspaceId) => {
          scheduleProjection(workspaceId, { immediate: true });
        },
        logger: logger.child({ component: "admin" }),
      });
    })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      if (request.url === "/health") {
        // Readiness only: no counts, no database sizes. Detailed state lives in
        // `/api/admin/status`, which requires the operator token.
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404);
      response.end();
    })
    .catch((error: unknown) => {
      logger.error("request failed", {
        requestId: requestLog.requestId,
        method: requestLog.method,
        path: requestLog.path,
        error: error instanceof Error ? error.message : String(error),
      });
      if (response.writableEnded) return;
      response.writeHead(500);
      response.end();
    });
});
health.listen(healthPort);

// Refresh SQLite's planner hourly; the timer is unref'd and never keeps the
// process alive on its own.
store.startMaintenance();

// Gauges are read at scrape time, so they see the live stores and the worker's
// current rooms rather than boot-time numbers.
processMetrics.setVersion(config.version);
processMetrics.setGauges({
  databaseBytes: () => store.size(),
  diskSoftBytes: () => currentLimits().limits.diskSoftBytes,
  documents: () => store.inventory().documents,
  openRooms: socketRoomCount,
  projectionRooms: () => worker.projectionRooms().length,
});

logger.info("server ready", {
  version: config.version,
  hosted: config.hosted,
  ws: `ws://localhost:${port}`,
  health: `http://localhost:${healthPort}`,
  documents: store.inventory(),
  shares: paths.shares,
  workspaces: paths.workspaces,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("server stopping", { signal });
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
