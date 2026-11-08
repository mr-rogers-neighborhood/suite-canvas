# ADR-0073: The control plane is a separate process from the relay

- Status: partial
- Date: 2026-10-26
- Related: [ADR-0070](0070-one-postgres-control-plane.md) (one Postgres), [ADR-0074](0074-the-relay-verifies-a-session-jwt-against-jwks.md) (the credential the relay accepts), [ADR-0078](0078-billing-runs-on-the-auth-plugin.md) (what the control plane hosts)
- Shipped: the relay is already its own process with its own SQLite stores and no `pg` dependency
  (`apps/collab-server/package.json`), and `services/auth` already has its own HTTP entry
  (`services/auth/src/http/entry.ts`).
- Remaining: `apps/control-plane` (planned) with the `RouteModule` contract, `/health` and request ids;
  its compose service; the three host routes in `deploy/Caddyfile`.

## Decision

Two processes sit behind one Caddy. The relay keeps the socket, its SQLite stores and the projection;
a new control plane hosts Postgres, Better Auth and Stripe and is the only process that depends on
`pg`. The host imports neither service: `services/auth` exports `authRoutes()` and `services/billing`
exports `billingRoutes()`, each answering `handle(req, res): boolean`, and the host mounts them at
`/api/auth/*`, `/api/billing/*` and `/stripe/*`. The relay gains no `pg` dependency and imports
nothing from the control plane.

## Rejected alternatives

- Mounting auth and billing inside the relay. The relay would take `pg`, a Stripe client and a session
  store, and it would put a database in the process whose licence check is meant to work with no
  network call. A payment provider outage would then land in the process holding open sockets.
- One process per service, three behind Caddy. Two extra hops for one origin, and the app needs a
  fourth route table to find them.
- A shared library both processes import. The coupling returns: a change to the billing store would
  recompile and redeploy the relay.

## Consequences

- A payment or sign-in outage can stop checkout and cannot stall an editing session.
- Two deployables, two health checks and one more container.
- The route-module contract is what lets two lanes change auth and billing without touching one file.
- `/api/*` and `/ws*` stay on the relay, so a control-plane restart drops no editing session.
