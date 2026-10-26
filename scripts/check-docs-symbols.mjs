/**
 * Checks that the symbols the docs name actually exist.
 *
 *   1. A backticked path with a slash and a known extension exists, from the
 *      repository root or from the page's own directory.
 *   2. A `pnpm <script>` that is not a pnpm built-in exists in the root
 *      `package.json`.
 *   3. An `ADR-NNNN` reference has a record in `internal/history/decisions` or
 *      `internal/decisions/open` when those trees are present.
 *
 * Globs, placeholders, and bare file names (`schema.ts`) are skipped: a page
 * may describe a naming convention without pointing at one file.
 *
 * Usage: node scripts/check-docs-symbols.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(root, "docs");
const ROOT_PAGES = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md"];
const KNOWN_EXT = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".css",
  ".sql",
  ".toml",
  ".png",
  ".svg",
  ".webp",
]);
const PATH_PREFIXES = [
  "apps/",
  "packages/",
  "services/",
  "scripts/",
  "e2e/",
  "docs/",
  ".github/",
  "assets/",
  "internal/",
];
const PNPM_BUILT_IN = new Set([
  "add",
  "audit",
  "bin",
  "config",
  "create",
  "dedupe",
  "dlx",
  "env",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "licenses",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "run",
  "self-update",
  "setup",
  "store",
  "unlink",
  "up",
  "update",
  "why",
]);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));
const problems = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "assets") found.push(...walk(path));
      continue;
    }
    if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

const pages = [...ROOT_PAGES.map((page) => join(root, page)), ...walk(docsRoot)].filter(
  (page) => existsSync(page) && statSync(page).isFile(),
);

const adrDirs = [
  join(root, "internal", "history", "decisions"),
  join(root, "internal", "decisions", "open"),
];
const haveAdrArchive = adrDirs.some((dir) => existsSync(dir));
const adrIds = new Set();
if (haveAdrArchive) {
  for (const dir of adrDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const match = entry.match(/^(\d{4})-/);
      if (match) adrIds.add(match[1]);
    }
  }
}

for (const page of pages) {
  const rel = relative(root, page).split("\\").join("/");
  const text = readFileSync(page, "utf8");

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const symbol = match[1].trim();
    const path = symbol.split(":")[0];
    if (!PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    if (/\s|[*<>{}]/.test(path)) continue;
    const ext = path.slice(path.lastIndexOf("."));
    if (!KNOWN_EXT.has(ext)) continue;

    const fromRoot = join(root, path);
    const fromPage = join(dirname(page), path);
    if (!existsSync(fromRoot) && !existsSync(fromPage)) {
      problems.push(`${rel}:${lineAt(text, match.index)}: missing path \`${path}\`.`);
    }
  }

  for (const code of text.matchAll(/`([^`\n]+)`/g)) {
    for (const match of code[1].matchAll(/\bpnpm\s+((?:--?[\w-]+\s+)*)([a-zA-Z][\w:-]*)/g)) {
      const flags = match[1];
      const name = match[2];
      if (PNPM_BUILT_IN.has(name)) continue;
      if (flags.trim() !== "") continue;
      if (!scripts.has(name)) {
        problems.push(`${rel}:${lineAt(text, code.index)}: \`pnpm ${name}\` is not a root script.`);
      }
    }
  }

  if (haveAdrArchive) {
    for (const match of text.matchAll(/\bADR-(\d{4})\b/g)) {
      if (!adrIds.has(match[1])) {
        problems.push(`${rel}:${lineAt(text, match.index)}: ADR-${match[1]} has no record.`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`docs symbol check failed: ${problems.length} problem(s).\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`docs symbol check passed: ${pages.length} pages.`);
