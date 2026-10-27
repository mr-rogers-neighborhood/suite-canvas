/**
 * Container plumbing shared by the three scanners that are not npm packages.
 *
 * OSV-Scanner, gitleaks and Trivy each run as a pinned image mounted over this
 * checkout, so a scan needs Docker and nothing else: no global install, no
 * account, no workflow. A missing daemon is reported as an instruction rather
 * than a stack trace, because the pre-commit hook calls this too.
 *
 * The images mount the repository at `/repo` on purpose. A path under the
 * host's home directory reaches a container on macOS only, and the same command
 * has to work on a Linux host.
 *
 * Usage: imported by `scripts/security-*.mjs`; not run directly.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_MOUNT = "/repo";

/** Docker cannot create a missing host directory for a mount. */
export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * The scanner processes write into the mounted directory, so they run as the
 * caller. Root-owned files in the checkout are a nuisance the next `pnpm
 * install` has to undo.
 */
function userArguments() {
  if (typeof process.getuid !== "function") return [];
  return ["--user", `${process.getuid()}:${process.getgid()}`];
}

export function dockerIsAvailable() {
  const probe = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

/** Prints why the scan cannot run and returns the exit code to use. */
export function reportMissingDocker(tool) {
  console.error(`${tool} runs as a container image and needs a working docker daemon.`);
  console.error("Start Docker (or install it) and run the same command again.");
  console.error(
    "A host that cannot run Docker cannot run this check; nothing is skipped silently.",
  );
  return 1;
}

/**
 * Runs one image and returns its exit status. `stdio: inherit` keeps the
 * scanner's own table, progress and colour on the terminal that started it.
 */
export function runImage({ image, args, mounts = [], env = {}, user = true }) {
  const argv = ["run", "--rm", "--init"];
  if (user) argv.push(...userArguments());
  for (const [key, value] of Object.entries(env)) argv.push("--env", `${key}=${value}`);
  for (const [host, container, mode = "rw"] of mounts) {
    argv.push("--volume", `${host}:${container}:${mode}`);
  }
  argv.push(image, ...args);

  const result = spawnSync("docker", argv, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}
