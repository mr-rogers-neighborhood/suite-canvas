/**
 * Renders `docs/reference/limits.md` from the values the code enforces.
 *
 * The page is generated because a limits table written by hand is wrong the
 * first time someone tunes a quota. Every number below is read at generation
 * time from:
 *
 *   - `apps/collab-server/src/config/limits.ts` — quotas, their defaults and env names
 *   - `apps/collab-server/src/store/shares.ts` — the selection-card cap
 *   - `apps/collab-server/src/projection/rooms.ts` — the open-room ceiling
 *   - `apps/collab-server/src/projection/model.ts` — the rebuild debounce
 *   - `packages/graph/src/publishValidation.ts` — the publish caps
 *   - `compose.yaml` — which stores are on the `suite-data` volume
 *
 * Usage:
 *   node scripts/generate-limits.mjs            # rewrite docs/reference/limits.md
 *   node scripts/generate-limits.mjs --check    # exit 1 if it is out of date
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTypeScript } from "./ts-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "docs/reference/limits.md");

registerTypeScript();

const { LIMIT_ENV, LIMIT_KEYS, SELF_HOSTED_DEFAULTS, HOSTED_DEFAULTS } = await import(
  "../apps/collab-server/src/config/limits.ts"
);
const { MAX_SELECTION_CARDS } = await import("../apps/collab-server/src/store/shares.ts");
const { DEFAULT_PROJECTION_BUILD_MS, DEFAULT_MAX_PROJECTION_CARDS, DEFAULT_PROJECTION_ROOM_LIMIT } =
  await import("../apps/collab-server/src/projection/rooms.ts");
const { DEFAULT_DEBOUNCE_MS } = await import("../apps/collab-server/src/projection/model.ts");
const { DEFAULT_MAX_PEERS_PER_ROOM, DEFAULT_ROOM_OUTSTANDING, LIMIT_CODES } = await import(
  "../apps/collab-server/src/sync/limits.ts"
);
const { DEFAULT_LAG_THRESHOLD_MS } = await import("../apps/collab-server/src/ops/eventLoopLag.ts");
const { MAX_FRAGMENT_BYTES, MAX_FRAME_BYTES } = await import(
  "../apps/collab-server/src/sync/outboundFragments.ts"
);
const { DEFAULT_PUBLISH_LIMITS, MAX_PUBLISH_COORDINATE } = await import(
  "../packages/graph/src/publishValidation.ts"
);
const { PUBLISH_REFUSAL_CODES } = await import("../apps/collab-server/src/http/shareDraft.ts");
const { MAX_ATTACHMENT_BYTES, attachmentDatabasePath } = await import(
  "../apps/collab-server/src/store/attachments.ts"
);
const { FREE_LICENCE_TIER } = await import("../services/auth/src/organizations/freeTier.ts");

/** The six stores, in the canonical order the README and operations use. */
const STORES = [
  { label: "Documents", env: "SUITE_DB" },
  { label: "Share links", env: "SUITE_SHARES_DB" },
  { label: "Workspaces", env: "SUITE_WORKSPACES_DB" },
  { label: "Settings", env: "SUITE_SETTINGS_DB" },
  { label: "Licence claims", env: "SUITE_LICENCE_DB" },
  { label: "Attachments", env: "SUITE_ATTACHMENTS_DB" },
];

const group = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Bytes with the exact count, so the page is quotable either way. */
function bytes(value) {
  if (value === null || value === Number.POSITIVE_INFINITY) return "unlimited";
  const units = [
    [1024 ** 3, "GiB"],
    [1024 ** 2, "MiB"],
    [1024, "KiB"],
  ];
  for (const [size, name] of units) {
    if (value >= size && value % size === 0) {
      return `${value / size} ${name} (${group(value)} bytes)`;
    }
  }
  return `${group(value)} bytes`;
}

function count(value) {
  if (value === null || value === Number.POSITIVE_INFINITY) return "unlimited";
  return group(value);
}

function envName(key) {
  return `\`${LIMIT_ENV[key]}\``;
}

/** Byte quotas read as sizes; workspace and card counts read as counts. */
const BYTE_KEYS = new Set([
  "documentBytesPerWorkspace",
  "projectionBytesPerWorkspace",
  "attachmentBytesPerWorkspace",
  "diskSoftBytes",
  "diskHardBytes",
]);

function quotaRow(label, key) {
  const format = BYTE_KEYS.has(key) ? bytes : count;
  return `| ${label} | ${envName(key)} | ${format(SELF_HOSTED_DEFAULTS[key])} | ${format(
    HOSTED_DEFAULTS[key],
  )} |`;
}

/** Reads one service block from `compose.yaml` without a YAML dependency. */
function composeService(text, name) {
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`compose.yaml has no \`${name}:\` service`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^ {2}\S/.test(line)) break;
    block.push(line);
  }
  return block;
}

/** `${VAR:-/data/x.sqlite}` becomes `/data/x.sqlite`; anything else is passed through. */
function resolveInterpolation(raw) {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  const match = /^\$\{[A-Z0-9_]+:-(.*)\}$/.exec(value);
  return (match ? match[1] : value).trim();
}

const compose = readFileSync(join(root, "compose.yaml"), "utf8");
const app = composeService(compose, "app");

const composeEnv = new Map();
for (const line of app) {
  const match = /^\s+([A-Z][A-Z0-9_]*):\s*(\S+)\s*$/.exec(line);
  if (match) composeEnv.set(match[1], resolveInterpolation(match[2]));
}

const mount = /^\s{6}-\s+([\w-]+):(\/[\w/.-]+)\s*$/m.exec(app.join("\n"));
if (mount === null) throw new Error("compose.yaml has no named volume mounted into `app`");
const [, volumeName, volumeTarget] = mount;

const storeRows = STORES.map(({ label, env }) => {
  const configured = composeEnv.get(env);
  if (configured === ":memory:") {
    return `| ${label} | \`${env}\` | \`:memory:\` (inside the process) | **no** |`;
  }
  if (configured !== undefined && configured !== "") {
    return `| ${label} | \`${env}\` | \`${configured}\` | yes |`;
  }
  const fallback =
    env === "SUITE_ATTACHMENTS_DB"
      ? `not set in \`compose.yaml\`; defaults to \`${attachmentDatabasePath({})}\` in the process working directory`
      : "not set in `compose.yaml`; the server default applies";
  return `| ${label} | \`${env}\` | ${fallback} | **no** |`;
});

const page = `# Limits

<!-- Generated by \`node scripts/generate-limits.mjs\` from
     \`config/limits.ts\`, \`store/shares.ts\`, \`store/attachments.ts\`,
     \`projection/rooms.ts\`, \`sync/limits.ts\`, \`sync/outboundFragments.ts\`,
     \`ops/eventLoopLag.ts\`, \`publishValidation.ts\`, \`http/shareDraft.ts\` and
     \`compose.yaml\`. Do not edit by hand; \`--check\` fails when this file is
     stale. -->

What one Suite instance accepts, and what happens at the boundary. The numbers
below are read from the code that enforces them, so they cannot drift from the
behaviour. Two surfaces enforce them: the relay (\`apps/collab-server\`) and the
publish validator (\`packages/graph\`).

## Workspaces and storage

| Quota | Variable | Self-host | Hosted (\`SUITE_HOSTED=1\`) |
| --- | --- | --- | --- |
${quotaRow("Workspaces per licence or instance", "maxWorkspaces")}
${quotaRow("Document bytes per workspace", "documentBytesPerWorkspace")}
${quotaRow("Projection bytes per workspace", "projectionBytesPerWorkspace")}
${quotaRow("Attachment bytes per workspace", "attachmentBytesPerWorkspace")}

A hosted licence carries its own \`workspaces\`, \`documentBytes\` and
\`attachmentBytes\`; the tighter of the licence and the instance value wins.
Self-hosting has no licence unless \`SUITE_LICENCE\` supplies one, so the storage
quotas above are unlimited until then. \`unlimited\` is also accepted as a value
for every quota.

### What an account actually gets

The table above is the instance ceiling, not the answer a reader wants. A hosted
account is capped by its licence row, and a new organization is born with no
workspace at all: local and offline use is free and needs no account, so an
account is what buys sync. These are the numbers the seat check enforces, read
from \`FREE_LICENCE_TIER\`.

| Cap | Born-with licence | Plan tier |
| --- | --- | --- |
| Workspaces | ${count(FREE_LICENCE_TIER.workspaces)} | from the plan |
| Seats | ${count(FREE_LICENCE_TIER.seats)} | from the plan |
| Document bytes per workspace | ${bytes(FREE_LICENCE_TIER.documentBytes)} | from the plan |
| Attachment bytes per workspace | ${bytes(FREE_LICENCE_TIER.attachmentBytes)} | from the plan |

A plan sells one seat in this build (ADR-0082): there is no per-seat price, so a
plan that declared more would bill one person and admit one person. The plan
figures are in \`deploy/stripe/fixtures.json\` and are not repeated here, because
they change with pricing rather than with code.

The projection budget is also a serving ceiling. A projection room whose stored
document is over it refuses a new join with \`${LIMIT_CODES.document}\`, because
each peer holds its own copy of the document in memory. Its bytes are kept, the
owner's workspace is not affected, and the share re-opens once the workspace is
trimmed or the budget is raised.

## Links, cards and selection

| Cap | Variable | Value | Refusal code | Where it is enforced |
| --- | --- | --- | --- | --- |
| Active share links per workspace | ${envName("sharesPerWorkspace")} | ${count(HOSTED_DEFAULTS.sharesPerWorkspace)} | none | Creating a link; existing links keep resolving |
| Cards in one selection share | ${envName("selectionCards")} / \`MAX_SELECTION_CARDS\` | ${count(MAX_SELECTION_CARDS)} | none | \`createShareQuotaGuard\`, \`shares.ts\` |
| Cards in one share projection | \`SUITE_MAX_PROJECTION_CARDS\` | ${count(DEFAULT_MAX_PROJECTION_CARDS)} | \`${LIMIT_CODES.cards}\` | \`projectionCardCount\`, \`projection/snapshot.ts\` |
| Cards per workspace | none | bounded by the document budget | none | A workspace over its budget pauses new share links; no card count is refused |
| Single attachment upload | none | ${bytes(MAX_ATTACHMENT_BYTES)} | none | \`readBytes\`, \`http/attachmentHttp.ts\` |

Cards per workspace has no number of its own on purpose. What a board may hold
is bounded by the document budget, because that is the number that costs disk,
and by the card cap above, because that is the number that costs the event loop.
Cards in one selection on the canvas stay bounded by what the browser can hold.

## Publish caps

A draft is written by a browser that any client can run, so the publisher
re-checks these on the projected plan. They are constants in
\`packages/graph/src/publishValidation.ts\`; only the two byte caps have an
environment override. A refused publish answers \`409\` and writes nothing.

| Cap | Variable | Value | Refusal code |
| --- | --- | --- | --- |
| Text bytes per card (title and body) | \`SUITE_PUBLISH_MAX_CARD_TEXT_BYTES\` | ${bytes(DEFAULT_PUBLISH_LIMITS.maxCardTextBytes)} | none |
| Bytes in one published draft | \`SUITE_PUBLISH_MAX_DRAFT_BYTES\` | ${bytes(DEFAULT_PUBLISH_LIMITS.maxDraftBytes)} | \`${PUBLISH_REFUSAL_CODES.draftTooLarge}\` |
| Largest absolute coordinate, size or z-order | none | ${group(MAX_PUBLISH_COORDINATE)} | none |
| Deepest rich-text nesting | none | ${count(DEFAULT_PUBLISH_LIMITS.maxRichTextDepth)} | none |
| Section title bytes | none | ${bytes(DEFAULT_PUBLISH_LIMITS.maxSectionTitleLength)} | none |
| Edge label bytes | none | ${bytes(DEFAULT_PUBLISH_LIMITS.maxEdgeLabelLength)} | none |

Only the draft byte cap has a code of its own. It is the one refusal an editor
can act on without reading the plan: the route answers
\`${PUBLISH_REFUSAL_CODES.draftTooLarge}\` in the \`409\` body, so the editor
says the draft is out of room rather than listing an unsupported change beside a
size limit nobody can see.

## Transport

A document reaches a peer over the room socket as Loro updates. \`loro-protocol\`
refuses to encode a message larger than ${bytes(MAX_FRAME_BYTES)}, so the relay
sends a larger payload as a fragment header followed by chunks, and the peer
reassembles the whole batch before it applies a byte. There is no document-size
ceiling on the socket: a 2 MiB workspace arrives the way a 20 KB one does.

| Frame | Source | Value |
| --- | --- | --- |
| Largest message either peer encodes | \`loro-protocol\` \`MAX_MESSAGE_SIZE\` | ${bytes(MAX_FRAME_BYTES)} |
| Payload carried by one fragment | \`sync/outboundFragments.ts\` \`MAX_FRAGMENT_BYTES\` | ${bytes(MAX_FRAGMENT_BYTES)} |
| Fragments in one document update | none | as many as its bytes need |

Before that was wired, the relay handed a joining peer its whole document in one
message. A board of 240 cards fit and a board of 400 did not, so syncing stopped
near 250 KB without a number anyone had chosen. That ceiling is gone: what bounds
a workspace here is the document budget above, which is a disk quota.

## Concurrency

These are per room, not per client address. The rate limits in
[../how-to/operate.md](../how-to/operate.md#fixed-limits-and-rate-limits) answer
"may this caller do more of this soon"; these answer "is this room too big to
serve", which is the question one huge board raises.

| Limit | Variable | Value | Refusal code | Behaviour at the limit |
| --- | --- | --- | --- | --- |
| Peers per room | \`SUITE_MAX_PEERS_PER_ROOM\` | ${count(DEFAULT_MAX_PEERS_PER_ROOM)} | \`${LIMIT_CODES.peers}\` | A join is refused before a session exists, so nothing is written. |
| Outstanding work per room | \`SUITE_ROOM_OUTSTANDING_MAX\` | ${count(DEFAULT_ROOM_OUTSTANDING)} | \`${LIMIT_CODES.backpressure}\` | A projection rebuild is refused rather than queued; the next save tries again. |
| Projection build time | \`SUITE_PROJECTION_BUILD_MS\` | ${count(DEFAULT_PROJECTION_BUILD_MS)} ms | \`${LIMIT_CODES.projectionBuild}\` | The room keeps its last good projection and stops rebuilding until a reload or a publish. |
| Open projection rooms | \`SUITE_PROJECTION_ROOMS_MAX\` | ${count(DEFAULT_PROJECTION_ROOM_LIMIT)} | none | The least-recently-used room with no connected client is closed and re-opens on demand. |
| Live rooms | none | no cap | none | A room lives while a client is connected; the process is single-replica by design. |

Every projection room records the source version vector it was built from. A
save whose source has not moved since that build is skipped rather than
rewritten, and a skipped rebuild costs one version comparison per open room.
\`suite_projection_skips_total\` counts them.

A rebuild follows a **save**, never an edit: the relay coalesces a room's writes
at \`saveInterval\` (2 000 ms), and the worker then waits
${count(DEFAULT_DEBOUNCE_MS)} ms more (\`DEFAULT_DEBOUNCE_MS\`). The floor on
share freshness is therefore one save window plus one rebuild, measured at 2.0 s
p50 and 2.1 s p99 for a 200-card board in four rooms with sixteen readers
(\`apps/collab-server/bench/report.md\`). Nothing in the projection path can be
fresher than the save it follows.

## Refusal codes

Each cap above refuses with one of these, on the wire where the caller can see
it and in the log line that records the refusal.

| Code | Refuses | Variable |
| --- | --- | --- |
| \`${LIMIT_CODES.document}\` | Serving a projection room whose stored document is over its budget | ${envName("projectionBytesPerWorkspace")} |
| \`${LIMIT_CODES.peers}\` | A join beyond the per-room peer cap | \`SUITE_MAX_PEERS_PER_ROOM\` |
| \`${LIMIT_CODES.cards}\` | Building a projection from an oversized board | \`SUITE_MAX_PROJECTION_CARDS\` |
| \`${LIMIT_CODES.backpressure}\` | A rebuild for a room already at its outstanding bound | \`SUITE_ROOM_OUTSTANDING_MAX\` |
| \`${LIMIT_CODES.projectionBuild}\` | Rebuilding a room that already exceeded the build-time cap | \`SUITE_PROJECTION_BUILD_MS\` |
| \`${PUBLISH_REFUSAL_CODES.draftTooLarge}\` | Publishing a draft over the projected size cap | \`SUITE_PUBLISH_MAX_DRAFT_BYTES\` |
| \`attachment-cap\` | An upload that would put a workspace over its attachment budget | ${envName("attachmentBytesPerWorkspace")} |

## Event-loop lag

The relay samples event-loop lag every 50 ms and exports the samples as the
\`suite_event_loop_lag_seconds\` histogram, with
\`suite_event_loop_lag_max_seconds\` for the worst sample so far and
\`suite_event_loop_lag_breaches_total\` for the samples over the threshold. A
save is judged by how late the loop was, not by how long the write took: the
document write runs off the loop, so a slow disk shows up as throughput and a
stalled loop shows up here.

Five breaching samples in a row log one line at \`warn\`, with
\`code: "event-loop-lag"\`, the threshold, the run length and the document write
counters for the same window. The counter resets when a sample is under the
threshold, so a second episode logs its own line.

| Threshold | Variable | Value |
| --- | --- | --- |
| Lag sample that counts as a breach | \`SUITE_EVENT_LOOP_LAG_MS\` | ${count(DEFAULT_LAG_THRESHOLD_MS)} ms |

## Disk watermarks

| Watermark | Variable | Self-host | Hosted (\`SUITE_HOSTED=1\`) |
| --- | --- | --- | --- |
${quotaRow("Document store size that logs a warning", "diskSoftBytes")}
${quotaRow("Document store size that refuses new workspaces", "diskHardBytes")}

A workspace that already exists keeps saving past the hard watermark; only a
new workspace is refused. Nothing is deleted to make room.

## Restore targets

\`compose.yaml\` keeps the stores on the named volume \`${volumeName}\`,
mounted at \`${volumeTarget}\` in the \`app\` container. A backup or restore
target is that volume, not an individual file: owner hashes, share rows and
documents refer to each other.

| Store | Variable | Path in the container | Survives a container recreate |
| --- | --- | --- | --- |
${storeRows.join("\n")}

Backup and restore use \`deploy/backup.sh\` and \`deploy/restore.sh\`; the
procedure is in [../how-to/operate.md](../how-to/operate.md#backups) and
[../how-to/release.md](../how-to/release.md).

## At the boundary

- A save is never dropped. A workspace over its document budget keeps loading
  and saving for its owner; what it loses is the ability to mint new share links.
- Only the places where nothing has been written yet are refused: a new
  workspace, a new share link, a new session in a room at its peer or byte
  ceiling, an oversized attachment, an oversized publish. A refused rebuild
  costs freshness for one share, never a byte of the workspace.
- A workspace room is never refused for being large, because its owner has to be
  able to open it to trim it, and a document larger than one frame is fragmented
  rather than refused. The ceiling that refuses a join is on a projection
  room, which is a copy the relay can always rebuild.
- Every refusal names the limit, the current value and the variable that sets
  it, so an operator can answer "why" without reading the code.
- The server validates every quota at boot: a value it cannot read is a startup
  error naming the variable, not a silent fallback.
`;

/** A quota added to `limits.ts` and forgotten here is a bug, not a style issue. */
for (const key of LIMIT_KEYS) {
  if (!page.includes(`\`${LIMIT_ENV[key]}\``)) {
    throw new Error(`limits.ts has \`${key}\` but the page never mentions ${LIMIT_ENV[key]}`);
  }
}

if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== page) {
    console.error(
      "docs/reference/limits.md is out of date. Run `node scripts/generate-limits.mjs` and commit the result.",
    );
    process.exit(1);
  }
  console.log("docs/reference/limits.md is up to date.");
  process.exit(0);
}

writeFileSync(target, page);
console.log(`wrote ${target}`);
