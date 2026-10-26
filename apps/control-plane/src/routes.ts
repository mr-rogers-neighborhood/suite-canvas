import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The contract every route module implements.
 *
 * A module is mounted for its `name` and consulted in mount order until one
 * answers. `handle` owns the request completely — it reads the body, writes the
 * status, headers and body — and says `true` when it did. `false` means "not
 * mine", and the next module is asked. A module that throws is answered with a
 * 500 by the host, so a fault is never a hung request.
 *
 * Two things a module may rely on:
 *
 * - `req.headers["x-request-id"]` is already the resolved request id (inbound or
 *   minted), the same value echoed on the response, so a module can log or
 *   forward it without minting a second one.
 * - The host has done nothing else: no routing, no body reading, no CORS. The
 *   module is the whole HTTP surface for its paths.
 *
 * `name` is also the key `/health` reports, and `auth` and `billing` are the
 * names that own Postgres-backed state (see `DATABASE_MODULES` in `config.ts`).
 */
export interface RouteModule {
  name: string;
  /** Returns true when the module handled the request. */
  handle(req: IncomingMessage, res: ServerResponse): boolean | Promise<boolean>;
}

/**
 * Structural check for a module a dynamic import handed back: the host cannot
 * import the concrete module types, so this is the only thing standing between
 * a typo in another package's export and a boot that half-works.
 */
export function isRouteModule(value: unknown): value is RouteModule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { name?: unknown; handle?: unknown };
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.handle === "function"
  );
}
