#!/usr/bin/env node
/**
 * Trivy against the runtime image.
 *
 * The app image carries Node, the compiled bundles and the production
 * `node_modules`, so its packages are a different set from the lockfile's: a
 * dependency installed for a build can pass every source scan and still sit in
 * the image, and a base-image CVE appears in no lockfile at all.
 *
 * The scope is what a release can act on: HIGH and CRITICAL only, and
 * `--ignore-unfixed` because a finding with no fixed version cannot be closed
 * by rebuilding the image. Everything else is noise in a table nobody reads.
 *
 * This is a release-time command; `pnpm verify` leaves it out because it needs
 * a built image. Build one with `docker build --target runtime -t suite:local .`
 * or name an image directly.
 *
 * Usage: node scripts/security-image.mjs [image]
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  dockerIsAvailable,
  ensureDirectory,
  reportMissingDocker,
  runImage,
} from "./security-docker.mjs";

const TRIVY_IMAGE = "aquasec/trivy:0.76.1";
const CACHE_DIR = join(homedir(), ".cache", "suite", "trivy");
const CACHE_MOUNT = "/trivy-cache";
const image = process.argv[2] ?? "suite:local";

if (!dockerIsAvailable()) process.exit(reportMissingDocker("Trivy"));

ensureDirectory(CACHE_DIR);

const status = runImage({
  image: TRIVY_IMAGE,
  args: [
    "image",
    "--scanners",
    "vuln",
    "--severity",
    "HIGH,CRITICAL",
    "--ignore-unfixed",
    "--exit-code",
    "1",
    "--cache-dir",
    CACHE_MOUNT,
    image,
  ],
  mounts: [
    // The daemon resolves the image; Trivy never pulls it itself here.
    ["/var/run/docker.sock", "/var/run/docker.sock"],
    [CACHE_DIR, CACHE_MOUNT],
  ],
  // The socket is owned by root:docker, so the scan keeps the container's own
  // user. Its only writes go to the cache directory above.
  user: false,
});

if (status === 0) {
  console.log(`trivy: no fixed HIGH or CRITICAL vulnerabilities in ${image}`);
} else {
  console.error(`trivy: ${image} has fixable HIGH or CRITICAL vulnerabilities (see above)`);
}
process.exit(status);
