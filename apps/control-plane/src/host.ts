import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { healthPayload, healthStatus } from "./health.js";
import { createLogger, type Logger, REQUEST_ID_HEADER, requestIdOf } from "./logging.js";
import type { ModuleStatus } from "./modules/index.js";
import type { RouteModule } from "./routes.js";

/**
 * The host: request id, `/health`, then the mounted modules in order. It knows
 * nothing about accounts or billing — a module decides every path it owns — so
 * adding a third module costs one file and no change here.
 */

export const HEALTH_PATH = "/health";

export interface ControlPlaneOptions {
  modules: readonly RouteModule[];
  /** One entry per expected module; reported by `/health` only. */
  statuses: readonly ModuleStatus[];
  buildId: string;
  logger?: Logger;
  now?: () => number;
}

export interface CloseOptions {
  /** How long a draining listener waits before it closes open connections. */
  drainMs?: number;
}

export interface ControlPlane {
  /** The `node:http` listener, exported so a test can serve it without a port. */
  readonly listener: (request: IncomingMessage, response: ServerResponse) => void;
  readonly server: Server;
  /** Binds the port and resolves the one actually bound (`0` picks an ephemeral one). */
  listen: (port: number) => Promise<number>;
  /** Stops accepting, drains, and resolves once the listener is closed. */
  close: (options?: CloseOptions) => Promise<void>;
}

const DEFAULT_DRAIN_MS = 10_000;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** Answer a request nobody has written to yet, without fighting a half-written one. */
function sendJsonUnlessStarted(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  if (response.headersSent) {
    response.end();
    return;
  }
  sendJson(response, status, body);
}

function pathnameOf(target: string | undefined): string {
  if (target === undefined) return "/";
  try {
    return new URL(target, "http://control-plane.invalid").pathname;
  } catch {
    return target.split("?")[0] ?? "/";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createControlPlane(options: ControlPlaneOptions): ControlPlane {
  const logger = options.logger ?? createLogger().child({ component: "control-plane" });
  const now = options.now ?? Date.now;
  const startedAt = now();

  async function handleHealth(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if ((request.method ?? "GET").toUpperCase() !== "GET") {
      response.setHeader("allow", "GET");
      sendJson(response, 405, { error: "method_not_allowed", requestId });
      return;
    }
    const payload = healthPayload({
      buildId: options.buildId,
      statuses: options.statuses,
      startedAt,
      now: now(),
    });
    sendJson(response, healthStatus(payload), payload);
  }

  async function dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
  ): Promise<void> {
    if (pathnameOf(request.url) === HEALTH_PATH) {
      await handleHealth(request, response, requestId);
      return;
    }

    for (const module of options.modules) {
      const handled = await module.handle(request, response);
      if (response.writableEnded) return;
      if (!handled) continue;
      // A module that claims a request must answer it; a hung socket is worse
      // than an obvious fault, and this is the only place that can say so.
      logger.error("route module claimed a request without answering", { module: module.name });
      sendJsonUnlessStarted(response, 500, {
        error: "module_did_not_answer",
        module: module.name,
        requestId,
      });
      return;
    }

    sendJson(response, 404, { error: "not_found", requestId });
  }

  const listener = (request: IncomingMessage, response: ServerResponse): void => {
    const requestId = requestIdOf(request);
    // The module sees the resolved id on the same header, so nothing downstream
    // has to mint a second one or be told about the middleware.
    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);

    const receivedAt = now();
    const method = (request.method ?? "GET").toUpperCase();
    const path = pathnameOf(request.url);
    response.once("finish", () => {
      logger.info("http.request", {
        requestId,
        method,
        path,
        status: response.statusCode,
        durationMs: Math.max(0, now() - receivedAt),
      });
    });

    void dispatch(request, response, requestId).catch((error: unknown) => {
      logger.error("request failed", { requestId, method, path, error: messageOf(error) });
      sendJsonUnlessStarted(response, 500, { error: "internal_error", requestId });
    });
  };

  const server = createServer(listener);

  function listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    });
  }

  function close(closeOptions: CloseOptions = {}): Promise<void> {
    const drainMs = closeOptions.drainMs ?? DEFAULT_DRAIN_MS;
    return new Promise((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // A keep-alive client that never sends another request would hold the
      // process open forever; past the deadline the sockets are closed and the
      // exit is still clean.
      const timer = setTimeout(() => {
        logger.warn("drain deadline reached", { drainMs });
        server.closeAllConnections();
      }, drainMs);
      timer.unref();
      server.close(finish);
      server.closeIdleConnections();
    });
  }

  return { listener, server, listen, close };
}
