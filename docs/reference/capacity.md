# Capacity

What one relay holds, what one more open room costs, and where the CPU stops keeping up. The numbers
on this page are measured on this checkout by `apps/collab-server/bench/sweep.mjs`, which runs `bench/load.mjs`
once per point in a fresh process and reads the relay's own `/metrics`; the raw reports are in
`apps/collab-server/bench/sweep.json`. Quotas, refusal codes and the save window are in
[limits.md](limits.md); this page is about what the machine does inside them.

## What was measured

- **Profile.** One board of 200 cards, a 219 KB workspace document, one reader in each share room, and
  two edits per run in the memory sweep. 200 cards is the largest board a joining peer can be given in
  this build: a document over 256 KiB never arrives, and that starts between 240 and 300 cards
  ([limits.md](limits.md#transport)).
- **What a room is.** An open projection room: one share link that a reader resolved. The workspace
  room that editors connect to is one per workspace whatever the reader count, so it shows up in the
  fixed cost, not the slope. Each projection room holds its own copy of the document, which is why it
  is the expensive one.
- **Steady state.** Three seconds after the last edit, the median of three scrapes 400 ms apart. A peak
  is one allocation burst away from being unrepresentative; the steady state is what the box has to
  hold for the next hour.
- **The gauge.** `suite_memory_split{segment="heap"|"external"|"arrayBuffers"|"rss"}`. A Loro document
  is WASM linear memory, which Node reports under `external` and `arrayBuffers` and never under
  `heap`, so `suite_rss_bytes` on its own cannot say what the memory is for.
- **The machine.** Intel Core i9-11900H, 16 logical CPUs, 33,328,463,872 bytes of RAM, Linux x64, Node
  v26.12.1. The relay is a child process of the load generator, so the two share cores, and the machine
  was also running other builds: `os.loadavg()` sat between 7.6 and 26.9 on 16 threads across these
  runs.

**Read every number here as an upper bound on latency and a lower bound on capacity.** Relay and
generator competed for the same cores, which inflates each stall the relay reports and understates how
many rooms it would serve alone. The instance re-run is the confirmation, not a follow-up: a `t4g`
core is slower than this laptop core and its memory is what an instance actually has. Nothing below
substitutes for running `bench/sweep.mjs` on the instance.

## Memory per open room

Rooms opened one after another, cards and peers held fixed, a fresh relay process per point:

| Rooms | RSS MiB | arrayBuffers MiB | external MiB | heap MiB | Document bytes |
| --- | --- | --- | --- | --- | --- |
| 1 | 218.8 | 5.2 | 9.5 | 48.0 | 219 103 |
| 4 | 260.9 | 7.8 | 12.2 | 50.6 | 219 176 |
| 16 | 399.7 | 23.4 | 27.7 | 73.9 | 219 158 |
| 32 | 546.5 | 17.0 | 21.3 | 59.3 | 219 546 |
| 64 | 863.9 | 42.2 | 46.5 | 88.2 | 219 094 |
| 128 | 1 506.2 | 73.4 | 77.7 | 211.6 | 219 236 |

Least squares over those six points, `bytes = intercept + slope × rooms`:

| Series | Intercept | Slope | R² |
| --- | --- | --- | --- |
| RSS | 233 429 325 B (222.6 MiB) | 10 530 089 B/room (10.04 MiB) | 0.9996 |
| arrayBuffers | 7 169 156 B (6.8 MiB) | 547 585 B/room (0.52 MiB) | 0.9642 |
| external | 11 700 323 B (11.2 MiB) | 547 471 B/room (0.52 MiB) | 0.9642 |
| heap | 40 705 776 B (38.8 MiB) | 1 278 478 B/room (1.22 MiB) | 0.9068 |

- **222.6 MiB before anyone connects.** That is Node, the TypeScript loader the bench runs, the SQLite
  connections and one workspace room holding a 219 KB document.
- **10.04 MiB of resident set per open room**, linear to within four parts in ten thousand over a
  range of 128. The document itself is 0.52 MiB of it: a 219 KB Loro document in WASM memory. V8's
  heap accounts for 1.22 MiB. The remaining ~8 MiB is memory the split does not attribute to live
  heap or to ArrayBuffers. Allocator arenas, and pages touched during a rebuild and not returned to
  the kernel, are the likely holders. That is why the resident set is the number to provision against
  and arrayBuffers is the number that explains where the documents are.
- **The 32-room arrayBuffers reading is lower than the 16-room one.** A projection pass allocates
  temporary Loro documents, and a scrape can land after one has been released and before the next is
  created, so a 32-room point can read below a 16-room one. The slope is still 0.52 MiB/room at
  R² 0.96, and RSS, the number provisioning uses, does not have this wobble.
- **The document cost is per room, not per peer.** A peer in a room is a socket and a presence entry
  in the relay; the document is one copy per room however many of the 64 peers are connected.

At the documented ceiling of 128 open rooms, the regression predicts
222.6 + 128 × 10.04 = 1 507.7 MiB; the run measured 1 506.2 MiB.

## Where the CPU stops keeping up

A rebuild follows a save, and a save window is 2 000 ms plus the worker's 200 ms debounce. One pass of
the projection worker costs one `projectWorkspace` plus one `mirrorWorkspace` per open room; on this
board those stages measure 137.92 ms and 34.62–36.52 ms
([report.md](../../apps/collab-server/bench/report.md#per-stage-cost-of-one-rebuild)). So a pass costs
about 138 ms + 37 ms per room, and one pass per window fits until roughly
(2 200 − 138) / 36.52 ≈ 57 rooms. Above that the pass is longer than the window it follows and the
queue grows.

Two runs test that, both at 200 cards and one peer per room.

**Raising the edit rate at 16 rooms.** Edits fired at a fixed rate and never waited for; the lag
histogram is the relay's own, sampled every 50 ms.

| Edits/s | Edits | Lag p50 | Lag p99 | Samples ≥ 100 ms | Delivery p50 |
| --- | --- | --- | --- | --- | --- |
| 0.25 | 6 | 2.6 ms | 580.0 ms | 23 of 520 | 2 489.7 ms |
| 1 | 20 | 2.9 ms | 1 840.0 ms | 36 of 376 | 5 182.2 ms |
| 4 | 80 | 3.1 ms | 3 031.3 ms | 35 of 315 | 3 066.3 ms |
| 16 | 320 | 3.3 ms | 3 690.0 ms | 39 of 262 | 3 862.5 ms |

The lag p99 crosses 100 ms at the lowest rate offered, 0.25 edits per second, and the median never
leaves single-digit milliseconds. Both have the same cause: `projectWorkspace` is 138 ms of
synchronous work, so one rebuild is already a stall longer than the 100 ms breach threshold, and the
median stays low because everything outside a rebuild is between stalls. **The p99 > 100 ms criterion
therefore does not identify a room count: it identifies the first rebuild.** What rises with the rate
is the tail and the delivery time, not the median. The last edit took 2.5 s to reach every room at a
quarter of an edit per second and 3.9 s at 16, at the same 16 rooms; a save in a busier window is more
likely to find the worker already inside a pass.

**Raising the room count at one edit per save window.** 0.45 edits/s, held for 20 s; "delivery" is
how long the last edit took to reach every peer, measured in the generator that made it, with a 30 s
deadline.

| Rooms | Lag p50 | Lag p99 | Samples ≥ 100 ms | Delivery p50 | Delivery p99 | Delivered |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | 2.7 ms | 1 510.0 ms | 25 of 396 | 1 691.1 ms | 1 699.1 ms | 16/16 |
| 32 | 3.0 ms | 1 925.0 ms | 43 of 345 | 3 145.0 ms | 3 264.4 ms | 32/32 |
| 64 | 3.5 ms | 3 864.3 ms | 72 of 318 | 5 307.1 ms | 5 331.9 ms | 64/64 |
| 128 | 4.2 ms | 499.2 ms | 132 of 429 | 12 179.0 ms | 12 390.5 ms | 128/128 |

Delivery is the save window (up to 2.2 s) plus the pass. At 16 rooms it is 1.7 s; at 32 it is 3.1 s,
which is one window plus a pass of about 0.9 s. At 64 it is 5.3 s, a pass of ~2.9 s, longer than the
window it follows, so a second save is already waiting when the first pass ends. At 128 it is 12.2 s,
roughly two passes plus two windows. Every edit did arrive at every room inside the 30 s deadline, so
nothing is lost; the reader waits, and the wait grows faster than the room count.

**The CPU ceiling is between 32 and 64 open rooms at 200 cards**, and the arithmetic above puts the
crossover at about 57. The room cap in [limits.md](limits.md#concurrency) is 128, so at this board
size the CPU is the binding constraint, not memory and not the cap.

**No build was refused.** `suite_projection_build_capped_total` stayed 0 at every point, including 128
rooms: the 5 s cap in `SUITE_PROJECTION_BUILD_MS` applies to one room's rebuild (~40 ms here), never to
a whole pass over 128 rooms. A frozen projection is a very large board's problem, not a many-room
problem.

## What an instance costs

Prices are AWS on-demand Linux list prices at the time of writing, in US dollars; they change, and they
exclude the storage and network lines below. Rooms are open projection rooms at 200 cards.

| Instance | vCPU / RAM | $/month | Rooms by memory\* | Room cap | Measured CPU ceiling | Binding ceiling | $/room-month |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `t4g.medium` | 2 / 4 GiB | 24.53 | 334 | 128 | ~57 | 57 | 0.43 |
| `t4g.large` | 2 / 8 GiB | 49.06 | 742 | 128 | ~57 | 57 | 0.86 |

\* Memory allows (3584 − 222.6) / 10.04 rooms on 4 GiB and (7680 − 222.6) / 10.04 on 8 GiB, after
reserving 512 MiB for the kernel, page cache and the rest of the image. t4g.medium and t4g.large have
the same two vCPUs, so the extra 4 GiB buys memory only, and memory is not what binds.

**Cost per concurrent editor, with the denominators named.** An "editor" here is one person with a
share room open, the memory-bearing case, at one peer per room:

- `t4g.medium`, 57 rooms, one reader each: **$0.43 per concurrent reader-month**.
- `t4g.large`, 57 rooms, one reader each: **$0.86 per concurrent reader-month**.
- Four readers sharing a room (`SUITE_MAX_PEERS_PER_ROOM` allows 64) divides those by four:
  **$0.11** and **$0.22 per reader-month**.
- If the board is small enough that a pass fits the window at 128 rooms, the cap binds instead and the
  same arithmetic gives **$0.19** and **$0.38 per room-month**.

An editor in a *workspace* room is cheaper than any of these: the relay gives them a socket and a
presence entry, and the workspace document is shared by everyone in the room. The sweep did not
isolate that cost, so this page does not quote one; the per-room figure is the number to plan with
because share rooms are what grow.

Two other lines belong in the monthly total:

| Line | Price | Example |
| --- | --- | --- |
| EBS gp3 | $0.08/GB-month | 30 GB (checkout, `node_modules`, pnpm store, image layers) = $2.40 |
| RDS `db.t4g.micro` | ~$11.68/month | Templates and accounts; plus its own storage, priced separately |

So a relay with 30 GB of gp3 and a micro Postgres is about **$38.61/month** on `t4g.medium` and
**$63.14/month** on `t4g.large`, before the IPv4 address, backups and data transfer. At 57 concurrent
readers that is $0.68 and $1.11 per reader-month all in, and at four readers per room, $0.17 and
$0.28.

The CPU ceiling is the single number that moves this table, and it moves with board size: a 40-card
board's pass is a fraction of a 200-card one, so small boards reach the 128-room cap and large boards
do not. The measured points are 200 cards because that is what a peer can be sent today.

## What was not measured

- **Boards above ~240 cards.** A joining peer never receives a document over 256 KiB, so a share room
  of 2 000 cards cannot be measured until snapshots are chunked
  ([report.md](../../apps/collab-server/bench/report.md#the-published-maximum-is-not-reachable-yet)).
- **More than one workspace in a process.** Every run used one workspace. A second workspace adds a
  workspace room and its own save schedule, not another copy per reader; it is not in the slope.
- **Peers per room.** One peer per room, so the per-peer cost inside a room (socket, presence) is not
  in these numbers. The 64-peer cap is a per-room limit on sockets, and the document is shared.
- **Graviton per-core speed.** The CPU ceiling was measured on an i9-11900H core. A `t4g` core is
  slower, so the room count on an instance is lower than 57 and the $/room figures above are floors.
- **Disk.** Document write throughput, WAL growth and backup cost are not in this pass; the size
  figures in [limits.md](limits.md) still bound a workspace.

## Reproducing

```sh
pnpm install
node apps/collab-server/bench/sweep.mjs                     # all three phases, ~15 min
node apps/collab-server/bench/sweep.mjs --phase=memory      # the table and the regression
node apps/collab-server/bench/sweep.mjs --phase=edits       # fixed rooms, rising edit rate
node apps/collab-server/bench/sweep.mjs --phase=load        # fixed rate, rising room count
```

Each phase writes into `bench/sweep.json` and keeps the phases already there, so one phase can be
re-run on its own. `--memory-rooms`, `--edit-rooms`, `--edit-rates`, `--load-rooms` and `--load-rate`
change the points. One relay process per point is the rule the script enforces; comparing two room
counts measured in one process would compare a cold box with a warm one.
