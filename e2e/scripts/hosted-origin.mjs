#!/usr/bin/env node
/**
 * The deployment shape a hosted install actually has: one origin for the page,
 * the account API and the sync socket.
 *
 * A production build is served by the reverse proxy in `compose.yaml`, so
 * `authServiceBase()` resolves to the page's own origin and the session cookie is
 * a first-party cookie. The dev server has no such proxy — `apps/canvas` is a
 * bare Vite process — and the control plane answers no CORS preflight at all, so
 * a page on `:5173` cannot call `:1236` for anything: the browser refuses the
 * response before the app can read it.
 *
 * Rather than fake that inside the browser (a route interceptor would hide the
 * cookie journey the suite exists to check), this file is the missing proxy. It
 * is deliberately tiny and lives with the harness:
 *
 * - `:5180` serves whatever Vite serves, so a spec that wants an account opens
 *   the workspace here and gets `/api/auth/*` from the control plane;
 * - everything under `/api/auth` is forwarded to the control plane, which is the
 *   only prefix the account module owns (`apps/control-plane/src/modules/auth.ts`);
 * - WebSocket upgrades ride the same connection, so Vite's HMR client keeps
 *   working instead of logging a failed socket on every page.
 *
 * The relay stays where it is. `collabHttpBase()`/`collabWsUrl()` in development
 * point at `:1235`/`:1234` directly, and that server does answer CORS for a
 * loopback origin — one proxy is enough.
 */
import { createServer, request as httpRequest } from "node:http";

/** Port the proxy binds. Listed in `preflight.mjs`. */
export const HOSTED_ORIGIN_PORT = 5180;

/** The Vite dev server `playwright.config.ts` starts. */
const CANVAS = { hostname: "localhost", host: "localhost", port: 5173 };

/** The control plane `scripts/control-plane.mjs` starts. */
const CONTROL_PLANE = { hostname: "127.0.0.1", host: "localhost", port: 1236 };

/**
 * The prefixes the control plane owns: Better Auth's own mount, the account-side
 * claim and invitation routes, the members read, and billing. Everything else is
 * the app — the relay's `/api/...` routes stay on `:1235`, which answers CORS.
 */
const ACCOUNT_PREFIXES = ["/api/auth", "/api/workspaces", "/api/invites", "/api/billing"];

function upstreamFor(pathname) {
  const owned = ACCOUNT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return owned ? CONTROL_PLANE : CANVAS;
}

function optionsFor(target, request) {
  return {
    host: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    // The upstream sees the Host it is configured for, not the one a reader
    // typed: Vite validates the header, and the control plane reads its own
    // origin from `SUITE_AUTH_URL` rather than from the request.
    headers: { ...request.headers, host: `${target.host}:${target.port}` },
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const target = upstreamFor(url.pathname);
  const upstream = httpRequest(optionsFor(target, request), (answer) => {
    response.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(response);
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end(`hosted origin: ${target.host}:${target.port} did not answer (${error.message})`);
  });
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const target = upstreamFor(url.pathname);
  const upstream = httpRequest(optionsFor(target, request));
  upstream.on("upgrade", (answer, upstreamSocket, upstreamHead) => {
    const headers = Object.entries(answer.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\r\n");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`);
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(HOSTED_ORIGIN_PORT, () => {
  console.log(`hosted origin: http://localhost:${HOSTED_ORIGIN_PORT} → canvas :5173, auth :1236`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
