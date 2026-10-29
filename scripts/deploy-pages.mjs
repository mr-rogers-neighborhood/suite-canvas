#!/usr/bin/env node
/**
 * Puts one of the two static sites on Cloudflare Pages.
 *
 * Pages builds nothing here: the directory is built locally, by the same command the gate
 * already runs, and then uploaded. That keeps the site a pure function of `docs/` and
 * `apps/site`, and means Cloudflare never has to reproduce the workspace, the pnpm version
 * or the Node version to serve a page that is already a file.
 *
 * The alternative — letting Pages run `pnpm build` — was rejected because a second builder
 * is a second set of versions to keep true, and a docs page that renders on Pages but not
 * locally is a difference nobody can debug from the box.
 *
 * Two things are required and neither is stored in the repository:
 *
 *   `CLOUDFLARE_API_TOKEN`   a token with the "Cloudflare Pages: Edit" permission, and
 *                            "Zone: DNS: Edit" when a custom domain is added.
 *   `CLOUDFLARE_ACCOUNT_ID`  the account the two projects live in.
 *
 * `wrangler login` also works, in which case neither variable is needed; the runbook in
 * `docs/how-to/deploy.md` covers both, and which one a deployment should use.
 *
 * Usage: pnpm deploy:docs | pnpm deploy:site [--no-build]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The two sites, and the only place their project names live.
 *
 * A name is an identifier on Cloudflare, not a label: renaming one in the dashboard moves
 * production to a new project and leaves the old one serving the custom domain, which reads
 * as a deploy that did nothing.
 */
const SITES = {
  docs: { project: "suite-docs", dist: join(root, "apps/docs/dist"), build: ["docs:site:build"] },
  site: { project: "suite-site", dist: join(root, "apps/site/dist"), build: ["site:build"] },
};

const target = process.argv[2];
const site = SITES[target];

if (!site) {
  console.error(
    `usage: node scripts/deploy-pages.mjs <${Object.keys(SITES).join("|")}> [--no-build]`,
  );
  process.exit(2);
}

const skipBuild = process.argv.includes("--no-build");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

if (!skipBuild) {
  for (const script of site.build) run(pnpm, [script]);
}

if (!existsSync(join(site.dist, "index.html"))) {
  console.error(`${site.dist} has no index.html; the build did not produce a site.`);
  process.exit(1);
}

// `wrangler` arrives through `pnpm dlx` rather than a dependency: it is a tool used on the
// day of a deploy, it is pinned at the call site, and a site build should not carry a CLI
// it never runs. `--branch main` sends the upload to the project's production environment;
// without it every deploy lands in a preview and the custom domain keeps serving the old
// tree, which is the failure this flag exists to prevent.
run(pnpm, [
  "dlx",
  "wrangler@4",
  "pages",
  "deploy",
  site.dist,
  "--project-name",
  site.project,
  "--branch",
  "main",
  "--commit-dirty",
]);
