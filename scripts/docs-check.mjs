/**
 * Checks the documentation for the drifts that keep coming back.
 *
 *   1. Relative links that point at a file that is not there, or at an anchor
 *      no heading in the target produces.
 *   2. Unbalanced code fences, and a fence that nobody closed.
 *   3. Retired terms: `GraphDocument`, `useGraphSnapshot`, "three SQLite files",
 *      and a stale "Yjs" claim about the current stack.
 *   4. Version consistency: the root `package.json`, the newest CHANGELOG
 *      heading, and the version the release procedure names must agree.
 *
 * Historical documents are exempt by path: an ADR that records a decision taken
 * with Yjs keeps saying Yjs, and the roadmaps own their own drift ledger.
 *
 * Usage: node scripts/docs-check.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files whose history is the point, so retired terms are correct in them. */
const HISTORY = ["docs/decisions/", "docs/roadmap/"];

/**
 * A page that explains the retired-term check has to name the terms. That page
 * carries this marker, which exempts it from the term scan only.
 */
const RETIRED_TERMS_MARKER = "<!-- docs-check: retired-terms-allowed -->";

/**
 * Terms that must not appear in a current document, with the reason the check
 * gives. `pattern` is matched per line; `allow` lists the phrases that are
 * still true and therefore permitted on the same line.
 */
const RETIRED = [
  {
    name: "GraphDocument",
    pattern: /\bGraphDocument\b/g,
    why: "the typed document layer is `WorkspaceDocument`",
  },
  {
    name: "useGraphSnapshot",
    pattern: /\buseGraphSnapshot\b/g,
    why: "the React binding is `useWorkspaceSnapshot`",
  },
  {
    name: "three SQLite files",
    pattern: /three SQLite files/gi,
    why: "the store count and the configured paths live in docs/limits.md",
  },
  {
    name: "stale Yjs claim",
    pattern: /\bYjs\b/g,
    why: "the CRDT is Loro (ADR-0015)",
    allow: [/Yjs-style/i, /no production Yjs/i],
  },
];

/**
 * Occurrences that are real drift but in a file this change does not own. They
 * are reported, not failed, so the check can run before the owning workstream
 * lands. The list must be empty at the release commit.
 */
const PENDING_OWNER_FIXES = [
  {
    file: "docs/security-model.md",
    term: "three SQLite files",
    owner: "data workstream (A1 store wording)",
  },
  {
    file: "docs/deploy-aws.md",
    term: "three SQLite files",
    owner: "data workstream (A1 store wording)",
  },
];

const SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", "dist", "coverage", "reports"]);

function markdownFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      markdownFiles(path, found);
    } else if (entry.endsWith(".md")) {
      found.push(path);
    }
  }
  return found;
}

const files = [
  ...[
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
  ]
    .map((name) => join(root, name))
    .filter((path) => existsSync(path)),
  ...markdownFiles(join(root, "docs")),
  ...(existsSync(join(root, ".github")) ? markdownFiles(join(root, ".github")) : []),
];

const problems = [];
const pending = [];

function relativePath(path) {
  return relative(root, path).split(sep).join("/");
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to dashes. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function anchorsOf(path) {
  const text = readFileSync(path, "utf8");
  const anchors = new Set();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) anchors.add(slugify(heading[1]));
  }
  return anchors;
}

const anchorCache = new Map();

function checkLinks(path, text) {
  const name = relativePath(path);
  let fenced = false;
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const link = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of line.matchAll(link)) {
      const href = match[1];
      if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("//")) continue;
      const [target, anchor] = href.split("#");
      const resolved = target === "" ? path : resolve(dirname(path), decodeURI(target));
      if (!existsSync(resolved)) {
        problems.push(`${name}:${index + 1} link target does not exist: ${href}`);
        continue;
      }
      if (!anchor || !resolved.endsWith(".md")) continue;
      let anchors = anchorCache.get(resolved);
      if (anchors === undefined) {
        anchors = anchorsOf(resolved);
        anchorCache.set(resolved, anchors);
      }
      if (!anchors.has(anchor.toLowerCase())) {
        problems.push(
          `${name}:${index + 1} anchor not found in ${relativePath(resolved)}: #${anchor}`,
        );
      }
    }
  }
}

function checkFences(path, text) {
  const name = relativePath(path);
  let open = null;
  for (const [index, line] of text.split("\n").entries()) {
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence === null) continue;
    if (open === null) {
      open = { line: index + 1, marker: fence[1] };
    } else if (fence[1] === open.marker) {
      open = null;
    }
  }
  if (open !== null) problems.push(`${name}:${open.line} code fence is never closed`);
}

function checkTerms(path, text) {
  const name = relativePath(path);
  if (HISTORY.some((prefix) => name.startsWith(prefix))) return;
  // A page that documents the check itself has to spell the terms out. The
  // marker is an HTML comment, so it is invisible in the rendered page.
  if (text.includes(RETIRED_TERMS_MARKER)) return;
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const term of RETIRED) {
      const matches = [...line.matchAll(term.pattern)];
      if (matches.length === 0) continue;
      if (term.allow?.some((allowed) => allowed.test(line))) continue;
      const entry = { file: name, line: index + 1, term: term.name, why: term.why };
      if (PENDING_OWNER_FIXES.some((fix) => fix.file === name && fix.term === term.name)) {
        pending.push(entry);
      } else {
        problems.push(`${name}:${index + 1} retired term "${term.name}" — ${term.why}`);
      }
    }
  }
}

for (const path of files) {
  const text = readFileSync(path, "utf8");
  checkLinks(path, text);
  checkFences(path, text);
  checkTerms(path, text);
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const released = /^##\s+\[?(\d[^\]\s]*)\]?/m.exec(changelog);
if (released === null) {
  problems.push("CHANGELOG.md: no `## [<version>]` heading");
} else if (released[1] !== version) {
  problems.push(`CHANGELOG.md: newest heading is ${released[1]} but package.json is ${version}`);
}

const release = join(root, "docs/release.md");
if (!existsSync(release)) {
  problems.push("docs/release.md: missing");
} else if (!readFileSync(release, "utf8").includes(`v${version}`)) {
  problems.push(`docs/release.md: does not name the tagged version v${version}`);
}

for (const entry of pending) {
  console.warn(
    `! ${entry.file}:${entry.line} "${entry.term}" — expected fix owned by ${
      PENDING_OWNER_FIXES.find((fix) => fix.file === entry.file)?.owner
    }`,
  );
}

if (problems.length > 0) {
  console.error(`${problems.length} documentation problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `docs check passed: ${files.length} files, ${pending.length} pending item(s) owned elsewhere.`,
);
