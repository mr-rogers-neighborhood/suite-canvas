# Load report

What `bench/load.mjs` measured on this checkout, at the profile printed with each run. The script starts
a real relay (`tsx src/server.ts`), seeds a workspace of the requested size, resolves and opens the
requested share rooms, joins the requested number of peers per room with real Loro clients, drives
edits, and reads the relay's own `/metrics`.

Nothing here is estimated except the lag percentile, which is interpolated from the exported histogram
buckets and is therefore accurate to one bucket width (the buckets are 5 ms apart below 50 ms).

## The published maximum is not reachable yet

The profile this report would like to publish is the published ceiling: 2 000 cards, 128 projection
rooms, 64 peers per room. It cannot be run on this stack, for a reason the runs below found and that is
not a matter of tuning:

- A peer receives a document in one Loro message, and `loro-protocol` caps a message at
  `MAX_MESSAGE_SIZE` = 256 KiB. Above that the message is never sent: the socket stays open, the join
  succeeds, and the document never arrives. Measured on this schema: a 219 KB board (200 cards) syncs;
  a 262 KB board (240 cards) syncs; a 437 KB board (400 cards) never arrives; a 546 KB board (500
  cards) never arrives. The ceiling therefore bites somewhere between 240 and 300 cards, well below
  `SUITE_MAX_PROJECTION_CARDS` (2 000).
- Chunked snapshot transfer is the fix, and it is the transport's, not the projection's: see
  [limits.md](../../../docs/reference/limits.md#transport) for what the relay sends today.

The numbers for the published maximum are therefore **pending**. The script runs them as soon as a
build can deliver a 2 000-card document to a peer:

```sh
pnpm --filter @suite/collab-server bench:load -- --cards=2000 --rooms=128 --peers=64 --edits=20
```

## Measured runs

Hardware: Intel Core i9-11900H, 16 logical CPUs, 33 328 463 872 bytes of RAM, Linux x64, Node v26.12.1.
The relay and the load generator shared the machine, which the RSS and latency numbers both reflect.

### Profile A: 200 cards, 4 rooms, 4 peers per room, 6 edits

| Measure | Before | After |
| --- | --- | --- |
| Workspace document | 219 022 bytes | 219 326 bytes |
| Projection rooms | 4 | 4 |
| Peers | 16 (4 per room) | 16 (4 per room) |
| Edits | 6 | 6 |
| Socket latency p50 / p99 | 10.58 ms / 861.73 ms | 10.22 ms / 22.24 ms |
| Share latency p50 / p99 | 20 534.60 ms / 40 959.73 ms | **1 993.73 ms / 2 094.78 ms** |
| Event-loop lag p50 / p99 | 2.5 ms / 5 ms (2 701 samples) | 2.6 ms / 515 ms (291 samples) |
| Peak RSS | 438 489 088 bytes (418 MiB) | 329 601 024 bytes (314 MiB) |
| Missed propagations | 0 | 0 |

### Profile B: 200 cards, 1 room, 1 peer, 3 edits (control)

| Measure | Before | After |
| --- | --- | --- |
| Socket latency p50 / p99 | 149.49 ms / 184.81 ms | 12.75 ms / 23.21 ms |
| Share latency p50 / p99 | 7 261.96 ms / 11 184.01 ms | **1 849.74 ms / 1 965.61 ms** |
| Event-loop lag p50 / p99 | 2.5 ms / 5.8 ms (584 samples) | 2.6 ms / 406.3 ms (175 samples) |
| Peak RSS | 269 520 896 bytes (257 MiB) | 252 870 656 bytes (241 MiB) |
| Missed propagations | 0 | 0 |

### Profile C: 40 cards, 2 rooms, 2 peers per room, 3 edits

| Measure | Before | After |
| --- | --- | --- |
| Workspace document | 45 634 bytes | 45 772 bytes |
| Socket latency p50 / p99 | 9.53 ms / 106.64 ms | 8.03 ms / 8.74 ms |
| Share latency p50 / p99 | 5 834.89 ms / 6 004.79 ms | **1 848.18 ms / 2 061.44 ms** |
| Event-loop lag p50 / p99 | 2.6 ms / 82.2 ms (407 samples) | 2.6 ms / 206.5 ms (187 samples) |
| Peak RSS | 192 376 832 bytes (183 MiB) | 181 780 480 bytes (173 MiB) |
| Missed propagations | 0 | 0 |

## What the numbers say

- **Share latency no longer drifts.** Before, the six edits of Profile A landed at 13.5 s, 18.9 s,
  28.4 s, 39.8 s, 45.3 s and then a miss: every save round was slower than the one before it, and the
  fifth edit never arrived inside the script's 60 s deadline. After, the six edits land at 2.09 s,
  1.99 s, 1.69 s, 2.05 s, 2.08 s and 1.91 s, and the three profiles agree to within 150 ms of each
  other at p50: the cost is one save window, not the board.
- **The rebuild was not the cost; what the rebuild wrote was.** `SUITE_PROJECTION_TRACE=1` timestamps
  three clocks in the relay: `scheduled` (a save asked for a rebuild), `refresh` (the pass that reads
  the rooms) and `rebuild` (one room). On the old code the pass itself was 1.2–1.5 s of a 13–45 s
  latency, and the room document grew by exactly one board per pass: the trace's `documentBytes` gauge
  went 189 873 → 400 381 → 610 903 → 821 425 → 1 031 947 → 1 242 469 → 1 452 991 across seven passes,
  ~211 KB each. A share room kept one `LoroDoc` for its lifetime and every rebuild cleared and rewrote
  every projection root, so the room's CRDT history grew without bound. Everything that touches that
  document then grew with it: the update each viewer receives, the snapshot the relay exports for every
  inbound update, the row it stores, and the join a new reader waits on.
- **The fix is the write, not the build.** A rebuild now writes only the entries that differ, so a save
  that moved one card writes 122 bytes into the room instead of 210 522, and the room's stored snapshot
  stays at 218 KB instead of reaching 850 KB after eight saves. `node apps/collab-server/bench/rebuild-cost.mjs`
  is that measurement; it is the one to re-run if this regresses. `projection/mirror.test.ts` pins the
  invariant the old path gave for free: an incremental pass ends exactly where a from-scratch build
  would, including a body whose text is unchanged and whose marks are not.
- **The lag p99 above is the boot pass, not a save.** These runs are now 15–20 s long instead of 150 s,
  so the one burst that opens four rooms at once is a far larger share of the histogram. In the traced
  run each of those four first builds measured 0.7–1.4 s; the same stages measure 0.14–0.17 s in
  isolation (below). This box runs the relay, the load generator and sixteen Loro peers together, so
  the relay's own stage timings move with machine load and are not the like-for-like number.
- Memory follows peers rather than rooms, and it came down with the document: 314 MiB at 16 peers
  against 418 MiB before. That is the number `SUITE_MAX_PEERS_PER_ROOM` bounds.
- The socket tail collapsed with the same change (861.73 ms → 22.24 ms at p99 in Profile A): the owner's
  echo was queued behind rebuilds that were writing megabytes of document.

## Per-stage cost of one rebuild

`node apps/collab-server/bench/profile-projection.mjs` builds the same 200-card, 219 KB board
`load.mjs` seeds and times each stage of `projectInto` in-process, on a room that already holds the previous
projection — the steady state a live share runs in.

| Stage | Median | Min / max |
| --- | --- | --- |
| `projectWorkspace` | 137.92 ms | 119.90 / 152.12 ms |
| `applyProjection` (clear and rewrite every root) | 138.42 ms | 123.68 / 150.59 ms |
| `mirrorWorkspace` (nothing changed) | 34.62 ms | 33.60 / 41.75 ms |
| `mirrorWorkspace` (one card moved) | 36.52 ms | 32.85 / 55.30 ms |
| `measureRoom` (update export) | 4.62 ms | 4.38 / 7.35 ms |
| `persistBaseline` (snapshot export + import, editor rooms) | 15.57 ms | 14.93 / 27.29 ms |

A save that moves one card therefore costs one `projectWorkspace` (138 ms) per distinct share target —
not per room, so four viewer links to one board pay it once — plus ~36 ms per room to mirror it in.

## A share follows its owner by one save window

`saveInterval` is 2 000 ms and the worker debounces another 200 ms before it reads the source, so a
share cannot be fresher than the save it follows. That floor is now the whole latency, and it is
published in [limits.md](../../../docs/reference/limits.md#concurrency) rather than left to be
rediscovered. Nothing in the projection path can move it: it is the save, not the rebuild, that a reader
waits on.

## Reproducing

```sh
pnpm install
pnpm --filter @suite/collab-server bench:load
pnpm --filter @suite/collab-server bench:load -- --cards=200 --rooms=4 --peers=4 --edits=6 --json
node apps/collab-server/bench/profile-projection.mjs   # per-stage cost of one rebuild
node apps/collab-server/bench/rebuild-cost.mjs        # what one rebuild writes per cycle
```

`--json` also writes `bench/report.json` next to this file. The run uses a temporary data directory
under `bench/` and removes it unless `--keep` is passed. `SUITE_PROJECTION_TRACE=1` (with `--verbose`)
prints the relay's `scheduled` / `refresh` / `rebuild` timing lines.
