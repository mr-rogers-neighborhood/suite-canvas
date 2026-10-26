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
- Chunked snapshot transfer is the fix, and it lives in the sync transport rather than in the relay
  code in this repository.

The numbers for the published maximum are therefore **pending**. The script runs them as soon as a
build can deliver a 2 000-card document to a peer:

```sh
pnpm --filter @suite/collab-server bench:load -- --cards=2000 --rooms=128 --peers=64 --edits=20
```

## Measured runs

Hardware: Intel Core i9-11900H, 16 logical CPUs, 33 328 463 872 bytes of RAM, Linux x64, Node v26.12.1.
The relay and the load generator shared the machine, which the RSS and latency numbers both reflect.

### Profile A: 200 cards, 4 rooms, 4 peers per room, 6 edits

| Measure | Value |
| --- | --- |
| Workspace document | 219 022 bytes (200 cards) |
| Projection rooms | 4 |
| Peers | 16 (4 per room) |
| Edits | 6 |
| Socket latency p50 / p99 | 10.58 ms / 861.73 ms |
| Share latency p50 / p99 | 20 534.60 ms / 40 959.73 ms |
| Event-loop lag p50 / p99 | 2.5 ms / 5 ms (2 701 samples) |
| Peak RSS | 438 489 088 bytes (418 MiB) |
| Missed propagations | 0 |

### Profile B: 200 cards, 1 room, 1 peer, 3 edits (control)

| Measure | Value |
| --- | --- |
| Socket latency p50 / p99 | 149.49 ms / 184.81 ms |
| Share latency p50 / p99 | 7 261.96 ms / 11 184.01 ms |
| Event-loop lag p50 / p99 | 2.5 ms / 5.8 ms (584 samples) |
| Peak RSS | 269 520 896 bytes (257 MiB) |
| Missed propagations | 0 |

### Profile C: 40 cards, 2 rooms, 2 peers per room, 3 edits

| Measure | Value |
| --- | --- |
| Workspace document | 45 634 bytes |
| Socket latency p50 / p99 | 9.53 ms / 106.64 ms |
| Share latency p50 / p99 | 5 834.89 ms / 6 004.79 ms |
| Event-loop lag p50 / p99 | 2.6 ms / 82.2 ms (407 samples) |
| Peak RSS | 192 376 832 bytes (183 MiB) |
| Missed propagations | 0 |

## What the numbers say

- The event loop stays flat while document writes run: lag p99 is 5 ms at 4 rooms and 5.8 ms at 1, and
  the single 82 ms sample in Profile C is the boot pass, not a save. A full-snapshot write of a 219 KB
  document no longer competes with socket frames, which is the point of moving it to a writer thread.
- Memory follows peers rather than rooms: 183 MiB at 4 peers, 257 MiB at 1 peer on a smaller board and
  418 MiB at 16 peers. That is the number `SUITE_MAX_PEERS_PER_ROOM` bounds.
- Share latency is not the rebuild. A 200-card rebuild is a fraction of a second (measured separately in
  `packages/graph/bench/projection.bench.ts`), and one room still shows 7.3 s p50. The relay coalesces
  socket saves at 2 s (`saveInterval`) and adds a 200 ms projection debounce, so a share follows its
  owner by several coalescing intervals rather than one. Profile A adds the four rooms the worker
  rebuilds one after another. This is the next thing to measure, and it is not attributable here to a
  single interval.
- The socket p99 of 862 ms in Profile A is the owner's echo session waiting behind the same coalescing,
  not the loop being blocked.

## Reproducing

```sh
pnpm install
pnpm --filter @suite/collab-server bench:load
pnpm --filter @suite/collab-server bench:load -- --cards=200 --rooms=4 --peers=4 --edits=6 --json
```

`--json` also writes `bench/report.json` next to this file. The run uses a temporary data directory
under `bench/` and removes it unless `--keep` is passed.
