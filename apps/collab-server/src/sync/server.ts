import { createServer } from "node:http";
import { licenceRequired } from "@suite/licence";
import { SimpleServer } from "loro-websocket/server";
import { validateConfig } from "../config/config.js";
import {
  createQuotaService,
  createShareQuotaGuard,
  limitsProblem,
  type QuotaOptions,
  readLimitOverrides,
  resolveLimits,
} from "../config/limits.js";
import { createWorkspaceAccess, type WorkspaceClaimDeps } from "../http/access.js";
import { handleAdminRequest } from "../http/admin/index.js";
import { handleAttachmentRequest } from "../http/attachmentHttp.js";
import { type AuthorizeDeps, decideAccess, resolveWorkerTokens } from "../http/auth.js";
import { handleReportRequest } from "../http/report.js";
import {
  createSessionVerifier,
  noSessionVerifier,
  type SessionVerifier,
} from "../http/sessionToken.js";
import { handleShareRequest } from "../http/shareHttp.js";
import { handleWorkspaceRequest } from "../http/workspaceHttp.js";
import { createLogger, createRequestLogger } from "../logging.js";
import { EventLoopLagMonitor, eventLoopLagThreshold } from "../ops/eventLoopLag.js";
import { metrics as processMetrics, readProcessRss } from "../ops/metrics.js";
import {
  forgetRoomDocument,
  loadLoroDocument,
  loroDocumentKey,
  loroDocumentKeys,
  ProjectionWorker,
  roomIdleHours,
  roomSessionCount,
} from "../projection/index.js";
import { defaultAttachmentStore } from "../store/attachments.js";
import { defaultLicenceClaimStore, type LicenceClaimStore } from "../store/licenceClaims.js";
import { createDocumentStore } from "../store/persistence.js";
import { createSettingsStore } from "../store/settings.js";
import {
  createShareStore,
  SHARE_ROOM_PREFIX,
  type Share,
  type ShareStore,
} from "../store/shares.js";
import { createWorkspaceOrgStore, type WorkspaceOrgStore } from "../store/workspaceOrgs.js";
import { joinRefusal, limitRoomOf, peersPerRoomLimit } from "../sync/limits.js";
import { fragmentOutboundFrames } from "../sync/outboundFragments.js";
import {
  disconnectProjectionViewers,
  disconnectWorkspaceShares,
  flushDirtyDocuments,
} from "../sync/roomSockets.js";
import { relaySeatGate } from "../sync/seatGate.js";

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
// Every store configures its own connection (`configureConnection` in
// `store/persistence.ts`): WAL, the busy timeout and the schema stamp travel
// with the module that opens the file, so none of them depends on a boot-time
// pass having run first.
const store = createDocumentStore(paths.documents, {
  // The counter is incremented where the write is durable, not where it is
  // accepted, so it can never run ahead of the disk.
  onWritten: (rows) => processMetrics.documentWritten(rows),
});
// Shares live in their own file so token writes never contend with the
// document store's save interval.
const shares = createShareStore(paths.shares);
// The workspace-to-organization mapping lives beside the share rows: it is
// authorization bookkeeping, not document state, so it stays out of the document
// store's save loop.
const orgs = createWorkspaceOrgStore(paths.workspaces);

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

// The hosted relay records the entitlement each workspace's organization bought;
// its quotas are the tighter of that record and the instance limits. A self-host
// never opens it, because it has no subscription to record.
const licenceClaims: LicenceClaimStore | null = licenceRequired()
  ? defaultLicenceClaimStore()
  : null;
// The seat gate answers from the verified token's claims, so it needs no store
// and no control-plane call. A self-host has no entitlement, so it is inert.
const seatGate = relaySeatGate(licenceRequired());

// The control plane publishes a JWKS at `SUITE_AUTH_URL`. Without that variable
// the relay runs anonymously: no session verifies, so no account reaches a room.
// A self-host that wants accounts sets it to its control-plane origin.
// `config.ts` has already parsed and normalised this to an origin, so the value
// the relay compares against is the same shape the control plane signed.
const authUrl = config.authUrl;
const sessions: SessionVerifier | undefined =
  authUrl === null ? undefined : createSessionVerifier({ authUrl, jwksUrl: config.authJwksUrl });
if (sessions === undefined) {
  logger.info("session verification is off", {
    hint: "set SUITE_AUTH_URL to the control-plane origin",
  });
}
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
// Same idea for organization rows: one attempt is one answer from the store,
// whatever the caller does with it. The outcome, never the workspace id, is the
// label.
const countedOrgs: WorkspaceOrgStore = {
  ...orgs,
  claim: (workspaceId, organizationId, now) => {
    const result = orgs.claim(workspaceId, organizationId, now);
    processMetrics.claimAttempted(result);
    return result;
  },
};
/**
 * What a verified session may record: the organization behind the workspace, and
 * the entitlement that organization bought. One object, so the join and the HTTP
 * routes cannot record different things.
 */
const workspaceClaims: WorkspaceClaimDeps = { orgs: countedOrgs, licences: licenceClaims };
// The same rule for a workspace-scoped HTTP route: it needs the session the join
// needs, and it is authorized by the same recorded organization.
const access = createWorkspaceAccess({
  sessions: sessions ?? noSessionVerifier,
  ...workspaceClaims,
});
const { projectionToken, sourceToken } = resolveWorkerTokens();

/**
 * Everything the socket's credential decision needs, in one object.
 *
 * Both the connection and the `/access` route read it, so "may this connection
 * join" and "why did you say no" cannot drift apart.
 */
const accessDeps: AuthorizeDeps = {
  shares: countedShares,
  ...(sessions === undefined ? {} : { sessions }),
  workspaces: workspaceClaims,
  projectionToken,
  sourceToken,
  seats: seatGate,
};

// Board and card shares read a projection room kept up to date by this worker.
const worker = new ProjectionWorker({
  url: `ws://localhost:${port}`,
  projectionToken,
  sourceToken,
  documents: store,
  shares,
  // Hosted links expire when nobody comes back; a self-host keeps them warm
  // unless the operator sets a window. The reader is the sync server itself,
  // which is declared below: the sweep only asks once it is running.
  idleHours: roomIdleHours(),
  roomClients: (roomId) => roomSessionCount(server, roomId, projectionToken),
  // A closed room must leave the server's room table too: `SimpleServer` keeps
  // one document per room for the life of the process, which is exactly the
  // memory a dead projection room holds on to.
  onRoomClosed: (roomId) => {
    forgetRoomDocument(server, roomId);
  },
  // One counter per rebuild outcome. The worker keeps its own numbers for the
  // operator inventory; this is the same event, counted once for the scraper.
  onRun: (run) => {
    if (run.kind === "skipped") processMetrics.projectionSkipped();
    if (run.kind === "capped") processMetrics.projectionCapped();
    if (run.kind === "refused") processMetrics.roomBackpressure();
  },
});

const isWorkspaceRoom = (roomId: string): boolean => !roomId.startsWith(SHARE_ROOM_PREFIX);

/** `SUITE_MAX_PEERS_PER_ROOM`, read once so every join compares the same number. */
const peerLimit = peersPerRoomLimit();

/**
 * What a room-limit check needs, read from the live process rather than stored:
 * peers from the sync server's own session table, and the document size from a
 * `length(state)` read, which never materializes the blob.
 *
 * Only a projection room is compared against a byte budget, and against the
 * projection budget, because that is the quota the workspace already agreed to
 * for its shared bytes.
 */
function joinFacts(roomId: string): {
  peers: number | null;
  documentBytes: number | null;
  documentBudget: number;
  peerLimit: number;
} {
  const room = limitRoomOf(roomId);
  const projection = room.startsWith(SHARE_ROOM_PREFIX);
  // A workspace room is never refused on size: the owner has to be able to open
  // it to trim it, and its saves are never dropped. What a projection room may
  // hold is a share of that workspace, so refusing to serve an oversized one
  // protects the process without taking anybody's workspace away.
  const documentBudget = projection
    ? currentLimits().limits.projectionBytesPerWorkspace
    : Number.POSITIVE_INFINITY;
  let documentBytes: number | null = null;
  if (projection) {
    for (const key of loroDocumentKeys(room)) {
      const bytes = store.measure(key);
      if (bytes !== null) documentBytes = Math.max(documentBytes ?? 0, bytes);
    }
  }
  return {
    peers: roomSessionCount(server, room, projection ? projectionToken : sourceToken),
    documentBytes,
    documentBudget,
    peerLimit,
  };
}

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

const server = fragmentOutboundFrames(
  new SimpleServer({
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

    async authenticate(roomId, _crdtType, auth) {
      const decision = await decideAccess(roomId, auth, accessDeps);
      const permission = decision.ok ? decision.permission : null;
      if (permission === null) return null;
      // A credential is not an answer to "is this room too big to serve". The
      // ceiling is per room, checked before the session exists, so a refusal
      // writes nothing and a workspace keeps saving whatever it is told here.
      const refusal = joinRefusal(limitRoomOf(roomId), joinFacts(roomId));
      if (refusal === null) return permission;
      if (refusal.code === "peer-limit") processMetrics.peerLimitRejected();
      else processMetrics.documentLimitRejected();
      logger.warn("join refused by a room limit", {
        code: refusal.code,
        message: refusal.message,
        room: limitRoomOf(roomId),
      });
      return null;
    },
  }),
);

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

// The same cadence as the expiry sweep. It is a no-op while
// `SUITE_ROOM_IDLE_HOURS` is off, which is the self-host default.
const idleSweep = setInterval(() => {
  void worker.sweepIdle().catch((error: unknown) => {
    logger.warn("idle room sweep failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  const syncServer = server as unknown as { evictIdleRooms?: () => Promise<number> };
  if (typeof syncServer.evictIdleRooms === "function") {
    void syncServer.evictIdleRooms().catch((error: unknown) => {
      logger.warn("idle sync room eviction failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}, 60_000);
idleSweep.unref();

const health = createServer((request, response) => {
  // One line per request, written when the response finishes. The target is
  // redacted first, so a share token or key never reaches stdout.
  const requestLog = createRequestLogger(request, response, { logger });
  // The narrowest point that sees every HTTP answer, including the ones the
  // share and workspace handlers write: one counter per status class, and a
  // 429 counted again as a rate-limit rejection.
  response.on("finish", () => processMetrics.observeHttp(response.statusCode));

  void handleShareRequest(request, response, countedShares, access, {
    onSharesChanged: (workspaceId) => {
      scheduleProjection(workspaceId, { immediate: true });
    },
    onShareRemoved: removeShare,
    // A link's first projection reads the *saved* workspace and saves are
    // coalesced, so a share created moments after an edit would otherwise show a
    // stale board until the next save tick.
    flush: async () => {
      if (!(await flushDirtyDocuments(server))) {
        logger.warn(
          "dirty-document flush is unavailable; a new share may project a slightly stale board",
        );
      }
    },
    publish: async (share, version, overwrite) => {
      processMetrics.publishAttempted();
      const result = await worker.publish(share, version, overwrite);
      if (!result.ok && result.conflicts.length > 0) processMetrics.publishConflict();
      return result;
    },
    reload: (share) => worker.reload(share),
    status: (share) => worker.status(share),
    // A room opens because somebody resolved its link. This is the only
    // viewer-side path that opens one: boot opens none, and an owner save only
    // refreshes the rooms already open.
    onShareOpened: (share) => worker.openShare(share),
  })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      // A delete removes rows through its own connection (`ops/admin.ts`), so
      // the writer's queue must be on disk first: otherwise the delete misses a
      // row still in memory and the next save puts it back.
      if (request.method === "DELETE") store.flush();
      return handleWorkspaceRequest(request, response, {
        access,
        // The socket's own decision, so the explanation this route gives and the
        // answer the connection gets are the same computation.
        decide: (workspaceId, token) =>
          decideAccess(workspaceId, new TextEncoder().encode(token), accessDeps, { claim: false }),
        licences: licenceClaims,
        // The same store the attachment route serves from: a deleted workspace
        // takes its image bytes with it, not just the rows that point at them.
        attachments: defaultAttachmentStore(),
        exists: (workspaceId) =>
          // The same evidence the admin inventory uses: a stored document under
          // any key a room may have used, or a share row that points here.
          loroDocumentKeys(workspaceId).some((key) => store.load(key) !== null) ||
          shares.list(workspaceId).length > 0,
        forgetWorkspace: (workspaceId) => {
          countedOrgs.remove(workspaceId);
        },
        onDeleted: (workspaceId) => {
          // The rows are gone, but the live room still holds the document and
          // saves every `saveInterval` — without this the workspace reappears
          // seconds after a successful delete. Close the sessions, drop the
          // in-memory room so nothing can save it again, and let the worker's
          // next pass find no shares and close the projections.
          server.disconnectRoomWhere(workspaceId, () => true);
          forgetRoomDocument(server, workspaceId);
          void worker.schedule(workspaceId, { immediate: true });
        },
      });
    })
    // Attachments are bytes beside the document, referenced by id from a card
    // body; the cap is the live resolved one, so an override applies at once.
    .then((handled) => {
      if (handled || response.writableEnded) return;
      return handleAttachmentRequest(request, response, access, {
        cap: () => currentLimits().limits.attachmentBytesPerWorkspace,
        orgs: countedOrgs,
      });
    })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      return handleAdminRequest(request, response, {
        documents: store,
        shares: countedShares,
        orgs: countedOrgs,
        paths,
        limits: currentLimits,
        settings,
        quotas,
        // The licence rows, writable so the gate is testable from the panel: a past-due
        // plan is an expired row and a cancelled one is no row, so no payment provider has
        // to be involved to see what either does.
        licences: licenceClaims,
        metrics: processMetrics,
        diskBytes: () => quotas.disk(),
        projectionRooms: () => worker.projectionRooms(),
        projectionStats: () => worker.projectionStats(),
        rssBytes: readProcessRss,
        sweepRooms: (options) => worker.sweepIdle(options),
        // The same store the attachment route serves from, so an exported
        // reprex carries the images the app would show.
        attachments: defaultAttachmentStore(),
        disconnectRoom: (roomId) => server.disconnectRoomWhere(roomId, () => true),
        onShareRemoved: removeShare,
        onSharesChanged: (workspaceId) => {
          scheduleProjection(workspaceId, { immediate: true });
        },
        logger: logger.child({ component: "admin" }),
        // The operator door is a session, verified against the same key set every join
        // uses: one identity, one answer to "who is this", in both directions.
        sessions: sessions ?? noSessionVerifier,
      });
    })
    .then((handled) => {
      if (handled || response.writableEnded) return;
      // CSP violation reports from the browser: public, bounded, and answered
      // `204` whatever happens, so a blocked asset never turns into a retry loop.
      return handleReportRequest(request, response);
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

/**
 * Event-loop lag, sampled every 50 ms, and published as a histogram rather than
 * as a duration for the save path: a document write is measured by how late the
 * loop was, not by how long the write took, because that is the number a reader
 * of the board feels. The sustained-breach line carries the write counters so
 * the one line an operator sees says whether writes are the cause.
 */
const lag = new EventLoopLagMonitor({
  thresholdMs: eventLoopLagThreshold(),
  logger,
  onBreach: () => processMetrics.eventLoopLagBroke(),
  context: () => ({
    documentWrites: processMetrics.snapshot().counters.documentWrites,
    documentWritesPending: store.writeStats().queued,
    projectionCapped: processMetrics.snapshot().counters.projectionCapped,
  }),
});
lag.start();

// Gauges are read at scrape time, so they see the live stores and the worker's
// current rooms rather than boot-time numbers.
processMetrics.setVersion(config.version);
processMetrics.setGauges({
  databaseBytes: () => store.size(),
  diskSoftBytes: () => currentLimits().limits.diskSoftBytes,
  documents: () => store.inventory().documents,
  openRooms: socketRoomCount,
  projectionRooms: () => worker.projectionRooms().length,
  documentWritesPending: () => store.writeStats().queued,
  eventLoopLagMaxSeconds: () => lag.maxSeconds(),
});
processMetrics.setHistograms([
  {
    name: "suite_event_loop_lag_seconds",
    help: "Event-loop lag per sample (seconds): how late the loop woke up.",
    bounds: lag.histogram.boundsSeconds,
    read: () => lag.histogram.snapshot(),
  },
]);

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
        clearInterval(idleSweep);
        health.close();
        lag.stop();
        // Closes the writer first and blocks until it is on disk, so a shutdown
        // never loses the last snapshot the server accepted.
        store.close();
        shares.close();
        orgs.close();
        process.exit(0);
      });
  });
}
