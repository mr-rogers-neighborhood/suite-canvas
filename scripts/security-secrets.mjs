#!/usr/bin/env node
/**
 * gitleaks over the working tree, and over the index from the pre-commit hook.
 *
 * A credential in history is not fixed by deleting a line: it is copied into
 * every clone, every backup and every fork. `pnpm security:secrets` scans every
 * file in the checkout and `.husky/pre-commit` runs the staged half, so a key
 * fails before it becomes a commit rather than after it becomes a rewrite.
 *
 * The allowlist in `.gitleaks.toml` names the gitignored paths a local machine
 * has (`.env`, `dist/`, `storybook-static/`) and the individual fake
 * credentials the fixtures use. It does not exempt test files wholesale.
 *
 * Findings print redacted: the file, the line and the rule, never the secret,
 * because this output lands in terminals and issue comments.
 *
 * Usage: node scripts/security-secrets.mjs [--staged]
 */
import {
  dockerIsAvailable,
  REPO_MOUNT,
  REPO_ROOT,
  reportMissingDocker,
  runImage,
} from "./security-docker.mjs";

const GITLEAKS_IMAGE = "zricethezav/gitleaks:v8.28.0";
const CONFIG = `${REPO_MOUNT}/.gitleaks.toml`;

const staged = process.argv.includes("--staged");
const scanArguments = [
  "--config",
  CONFIG,
  "--redact",
  "--no-banner",
  "--exit-code",
  "1",
  // Without this gitleaks prints a count; with it, the file, line and rule —
  // the three things needed to fix or allowlist a finding.
  "--verbose",
];

if (!dockerIsAvailable()) process.exit(reportMissingDocker("gitleaks"));

// `git --staged` reads the index, which is what a commit is about to record.
// `detect --no-git` walks the tree, which also covers files not yet added.
const toolArguments = staged
  ? ["git", "--staged", ...scanArguments, REPO_MOUNT]
  : ["detect", "--no-git", `--source=${REPO_MOUNT}`, ...scanArguments];

const status = runImage({
  image: GITLEAKS_IMAGE,
  args: toolArguments,
  mounts: [[REPO_ROOT, REPO_MOUNT]],
});

if (status === 0) {
  console.log(
    staged
      ? "gitleaks: no secrets in the staged changes"
      : "gitleaks: no secrets in the working tree",
  );
}
process.exit(status);
