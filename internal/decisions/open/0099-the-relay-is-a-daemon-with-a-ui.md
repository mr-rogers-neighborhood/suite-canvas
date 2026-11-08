# ADR-0099: The relay is a daemon, and the hub is one of its hosts

- Status: proposed
- Date: 2026-11-05
- Related: `apps/collab-server`, ADR-0073, `docs/explanation/sync-hosting.md`, `packages/contracts`
  and `apps/start` in the suite-start repository
- Remaining: the standalone relay package, its command line, and the shared module that reports status
  and produces the pairing code.

## Decision

Sync ships as a headless daemon with a command line, and any process may supervise it. Start may spawn,
watch and stop it, and so may an app, from a "serve this workspace from this computer" action. No app
requires Start, because every app has to work with the hub uninstalled.

One module reports the three states (`running`, `asleep`, `unreachable`) and produces the pairing code,
so every host shows the same thing. The hosted tier runs the same process, which is why the decision
belongs to the suite rather than to the hub.

## Rejected alternatives

- **The relay as part of Start.** It makes the hub a requirement for a feature of the app, and it puts a
  server inside a window that may not be open.
- **A relay embedded in each app.** Three copies of a socket server, three upgrade paths, and two apps
  that would disagree about the room.
- **A hosted relay only.** Self-hosting is the point of a local-first suite, and the hosted tier has to
  be one deployment of the same process rather than a second implementation.

## Consequences

- Start's Sync section reports a state it does not own, and says it is not configured until a relay
  exists.
- The relay can run where it belongs: a container, a NAS, a Raspberry Pi, or a systemd unit.
- The suite owns one supervisor contract, so a fourth app does not invent its own toggle.
