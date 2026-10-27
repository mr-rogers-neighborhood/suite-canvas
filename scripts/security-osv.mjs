#!/usr/bin/env node
/**
 * OSV-Scanner against `pnpm-lock.yaml`.
 *
 * `pnpm audit` reads one advisory feed; OSV reads the ecosystem-wide database,
 * so the two disagree about both what is vulnerable and what fixes it, and the
 * disagreement is the useful part. The scan reads the lockfile, not
 * `node_modules`, so it answers for every workspace at once and takes seconds.
 *
 * Three modes:
 *
 *   node scripts/security-osv.mjs               scan, fetching the database
 *   node scripts/security-osv.mjs --download    fetch the database into the cache
 *   node scripts/security-osv.mjs --offline     scan with no network at all
 *
 * `--offline` needs a populated cache, which `--download` creates while online;
 * the two together are how a machine on a plane keeps scanning. `--licences`
 * additionally reports packages whose licence is outside the allowlist below.
 * It is opt-in because the answer is a legal decision, not a build failure
 * somebody else should inherit.
 *
 * Usage: node scripts/security-osv.mjs [--offline] [--download] [--licences]
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  dockerIsAvailable,
  ensureDirectory,
  REPO_MOUNT,
  REPO_ROOT,
  reportMissingDocker,
  runImage,
} from "./security-docker.mjs";

const OSV_IMAGE = "ghcr.io/google/osv-scanner:v2.7.0";
const CACHE_DIR = join(homedir(), ".cache", "suite", "osv-scanner");
const DATABASE_MOUNT = "/osv";

/**
 * Licences this project ships under. MPL-2.0 and the LGPL are reachable only
 * through build tooling (lightningcss) and are deliberately absent: allowing
 * them is a decision to take on the record, not a default.
 */
const LICENCE_ALLOWLIST = [
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Python-2.0",
  "Unlicense",
  "Zlib",
];

const offline = process.argv.includes("--offline");
const download = process.argv.includes("--download");
const licences = process.argv.includes("--licences");

if (!dockerIsAvailable()) process.exit(reportMissingDocker("OSV-Scanner"));

ensureDirectory(CACHE_DIR);

if (offline && readdirSync(CACHE_DIR).length === 0) {
  console.error(`No OSV database in ${CACHE_DIR}, so there is nothing to scan offline.`);
  console.error("Run `pnpm security:osv --download` once while online, then use --offline.");
  process.exit(1);
}

const args = ["scan", "source", `--lockfile=${REPO_MOUNT}/pnpm-lock.yaml`];

if (download) args.push("--download-offline-databases");
if (offline || download) args.push("--offline-vulnerabilities");
// `--offline` last: it disables every remaining feature that would open a
// socket, so a scan that cannot reach the network fails loudly instead of
// quietly reporting nothing.
if (offline) args.push("--offline");
if (licences) args.push(`--licenses=${LICENCE_ALLOWLIST.join(",")}`);
args.push("--format=table");

const mounts = [
  [REPO_ROOT, REPO_MOUNT, "ro"],
  [CACHE_DIR, DATABASE_MOUNT, download ? "rw" : "ro"],
];

const status = runImage({
  image: OSV_IMAGE,
  args,
  mounts,
  env: { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: DATABASE_MOUNT },
});

if (status === 0) console.log("osv-scanner: no known vulnerabilities in pnpm-lock.yaml");
if (licences && status !== 0) {
  console.log("osv-scanner: the table above includes licences outside the allowlist");
}
process.exit(status);
