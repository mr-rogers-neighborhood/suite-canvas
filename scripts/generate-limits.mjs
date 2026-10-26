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
const { DEFAULT_PROJECTION_ROOM_LIMIT } = await import(
  "../apps/collab-server/src/projection/rooms.ts"
);
const { DEFAULT_PUBLISH_LIMITS, MAX_PUBLISH_COORDINATE } = await import(
  "../packages/graph/src/publishValidation.ts"
);
const { attachmentDatabasePath } = await import("../apps/collab-server/src/store/attachments.ts");

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
     \`config/limits.ts\`, \`store/shares.ts\`, \`projection/rooms.ts\`,
     \`publishValidation.ts\` and \`compose.yaml\`. Do not edit by hand;
     \`--check\` fails when this file is stale. -->

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
Self-hosting has no licence, so the storage quotas are unlimited unless you set
one. \`unlimited\` is also accepted as a value for every quota.

## Links, cards and selection

| Cap | Variable | Value | Where it is enforced |
| --- | --- | --- | --- |
| Active share links per workspace | ${envName("sharesPerWorkspace")} | ${count(HOSTED_DEFAULTS.sharesPerWorkspace)} | Creating a link; existing links keep resolving |
| Cards in one selection share | ${envName("selectionCards")} / \`MAX_SELECTION_CARDS\` | ${count(MAX_SELECTION_CARDS)} | \`createShareQuotaGuard\`, \`shares.ts\` |
| Cards per workspace | none | no cap | Bounded by document bytes |
| Cards in one selection on the canvas | none | no cap | Bounded by what the browser can hold |

## What this build does not cap

Four limits that a reader expects on this page have no enforced value, so the
tables above report them as unlimited or as no cap:

- Document bytes per workspace: unlimited on an instance, and the hosted licence
  carries the cap that applies to a hosted workspace.
- Attachment bytes per workspace: unlimited on an instance, and the hosted
  licence carries that cap too.
- Cards per workspace, and cards in one selection on the canvas: no cap. The
  document byte quota is what bounds a workspace.
- Peers in one room, and rooms open at once: no cap beyond the projection room
  ceiling in the next table. Memory is the real limit.

The Beta plan proposes a number for each of them. A proposal is not a limit, so
none is published here until the code enforces one.

## Publish caps

A draft is written by a browser that any client can run, so the publisher
re-checks these on the projected plan. They are constants in
\`packages/graph/src/publishValidation.ts\`; only the two byte caps have an
environment override.

| Cap | Variable | Value |
| --- | --- | --- |
| Text bytes per card (title and body) | \`SUITE_PUBLISH_MAX_CARD_TEXT_BYTES\` | ${bytes(DEFAULT_PUBLISH_LIMITS.maxCardTextBytes)} |
| Bytes in one published draft | \`SUITE_PUBLISH_MAX_DRAFT_BYTES\` | ${bytes(DEFAULT_PUBLISH_LIMITS.maxDraftBytes)} |
| Largest absolute coordinate, size or z-order | none | ${group(MAX_PUBLISH_COORDINATE)} |
| Deepest rich-text nesting | none | ${count(DEFAULT_PUBLISH_LIMITS.maxRichTextDepth)} |
| Section title bytes | none | ${bytes(DEFAULT_PUBLISH_LIMITS.maxSectionTitleLength)} |
| Edge label bytes | none | ${bytes(DEFAULT_PUBLISH_LIMITS.maxEdgeLabelLength)} |

## Concurrency

| Limit | Variable | Value | Behaviour at the limit |
| --- | --- | --- | --- |
| Open projection rooms | \`SUITE_PROJECTION_ROOMS_MAX\` | ${count(DEFAULT_PROJECTION_ROOM_LIMIT)} | The least-recently-used room with no connected client is closed and re-opens on demand. |
| Peers per room | none | no cap | Every session in a room shares one process and one document; RAM is the real ceiling. |
| Live rooms | none | no cap | A room lives while a client is connected; the process is single-replica by design. |

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
  workspace, a new share link, an oversized attachment, an oversized publish.
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
