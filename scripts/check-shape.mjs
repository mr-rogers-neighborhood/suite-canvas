/**
 * Mechanical shape rules that TypeScript and Biome cannot express.
 *
 *   1. No source file over 900 lines, except data files that are lists.
 *   2. No function signature with more than 6 parameters.
 *   3. No `dangerouslySetInnerHTML`, `eval`, or `new Function`.
 *   4. `WorkspaceDocument.observe` has one call site: the snapshot store.
 *   5. Graph roots are written through `@suite/graph`, not raw Loro.
 *
 * Tests and stories are exempt: a test fixture may build a document directly,
 * and a story is a fixture by another name.
 *
 * Usage: node scripts/check-shape.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["apps/canvas/src", "apps/collab-server/src", "services", "packages"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  "storybook-static",
  ".turbo",
  "coverage",
]);
const TEST_OR_STORY = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const DATA_LIST = /(?:^|\/)recoveryWords\.ts$/;
const MAX_FILE_LINES = 900;
const MAX_PARAMS = 6;
const OBSERVE_ALLOWED = "apps/canvas/src/store/workspaceSnapshotStore.ts";

const GRAPH_ROOTS = [
  "boards",
  "cards",
  "placements",
  "sections",
  "types",
  "tags",
  "edges",
  "views",
  "content",
  "titles",
  "references",
];
const RAW_WRITE = new RegExp(String.raw`get(Map|List)\("(?:${GRAPH_ROOTS.join("|")})"\)`, "g");

const problems = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(join(dir, entry.name)));
      continue;
    }
    if (SOURCE_FILE.test(entry.name) && !TEST_OR_STORY.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function countParams(params) {
  const trimmed = params.trim();
  if (trimmed === "") return 0;
  let depth = 0;
  let count = 1;
  for (const char of trimmed) {
    if ("([{<".includes(char)) depth += 1;
    else if (")]}>".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) count += 1;
  }
  return count;
}

const files = SOURCE_ROOTS.flatMap((dir) => walk(join(root, dir)));

for (const file of files) {
  const rel = relative(root, file).split("\\").join("/");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  if (lines.length > MAX_FILE_LINES && !DATA_LIST.test(rel)) {
    problems.push(
      `${rel}: ${lines.length} lines, limit ${MAX_FILE_LINES}. Split by responsibility.`,
    );
  }

  lines.forEach((line, index) => {
    const signature = line.match(
      /(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?)\(([^)]*)\)/,
    );
    if (signature && countParams(signature[1]) > MAX_PARAMS) {
      problems.push(`${rel}:${index + 1}: more than ${MAX_PARAMS} parameters. Pass an object.`);
    }
    if (/dangerouslySetInnerHTML|\beval\s*\(|\bnew Function\s*\(/.test(line)) {
      problems.push(`${rel}:${index + 1}: banned dynamic-HTML or dynamic-code API.`);
    }
    if (/\bworkspace\.observe\s*\(/.test(line) && rel !== OBSERVE_ALLOWED) {
      problems.push(
        `${rel}:${index + 1}: second \`WorkspaceDocument.observe\` call site. ` +
          `Subscribe through the snapshot store.`,
      );
    }
    if (!rel.startsWith("packages/graph/")) {
      for (const match of line.matchAll(RAW_WRITE)) {
        problems.push(
          `${rel}:${index + 1}: raw Loro write to \`${match[1]}\`. ` +
            `Add a typed method to \`@suite/graph\`.`,
        );
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`shape check failed: ${problems.length} problem(s).\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`shape check passed: ${files.length} source files.`);
