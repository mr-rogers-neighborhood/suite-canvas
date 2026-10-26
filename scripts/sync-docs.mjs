#!/usr/bin/env node
/**
 * Mirrors `docs/` into `apps/docs/content/docs/` for the Fumadocs site.
 *
 * The repository's Markdown is plain (`docs/README.md`, no frontmatter), while
 * `@fumadocs/local-md` validates every page against `pageSchema`, which requires
 * a `title`. So this script is the adapter: it copies the tree, injects the
 * frontmatter Fumadocs needs, and rewrites the links a browser cannot resolve.
 *
 *   1. `docs/scratchpad.md` is per-machine state and never published.
 *   2. `README.md` becomes `index.md` (Fumadocs' folder index page).
 *   3. A missing `title` comes from the page's `# ` heading, which is then
 *      removed from the body so the page does not render two H1s. A missing
 *      `description` comes from the first prose paragraph.
 *   4. `meta.json` in every directory lists its pages explicitly: a `pages`
 *      array *replaces* the automatic order in Fumadocs, so an entry that is
 *      left out disappears from the sidebar.
 *   5. Relative links that leave `docs/` point at GitHub instead, because the
 *      site has no page for them. Links into an `assets/` folder are copied to
 *      `public/docs/` so their relative `src` resolves at the page URL.
 *   6. HTML comments are dropped; they carry no published meaning.
 *
 * The output is a pure function of `docs/`: the target is deleted first, entries
 * are walked in sorted order, and nothing is read from the previous run.
 *
 * Usage: node scripts/sync-docs.mjs
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "docs");
const contentDir = join(root, "apps/docs/content/docs");
const assetDir = join(root, "apps/docs/public/docs");

const GITHUB_BLOB = "https://github.com/mr-rogers-neighborhood/suite-canvas/blob/main/";
const GITHUB_TREE = "https://github.com/mr-rogers-neighborhood/suite-canvas/tree/main/";

/** Per-machine files that must not be published. */
const SKIPPED = new Set(["scratchpad.md"]);

/** Last git commit date, or mtime for a page that is not committed yet. */
function lastModified(path) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", `docs/${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return out;
  } catch {
    // fall through to mtime
  }
  return statSync(join(sourceDir, path)).mtime.toISOString();
}

/** The Diátaxis shape the site should open with; anything else is appended. */
const ROOT_ORDER = ["index", "tutorials", "how-to", "reference", "explanation"];

const DESCRIPTION_LIMIT = 160;

/**
 * Walk `docs/` and return every published entry as a POSIX path relative to it,
 * sorted so two runs always produce the same meta.json.
 */
async function walk(dir, prefix = "") {
  const entries = await readdir(join(sourceDir, dir), { withFileTypes: true });
  const files = [];
  const dirs = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (SKIPPED.has(rel)) continue;
    if (entry.isDirectory()) {
      dirs.push(rel);
      const nested = await walk(rel, rel);
      files.push(...nested.files);
      dirs.push(...nested.dirs);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(rel);
    }
  }
  return { files, dirs };
}

/** Copy every non-Markdown file (images, data) next to the pages. */
async function copyAssets(prefix = "") {
  const entries = await readdir(join(sourceDir, prefix), { withFileTypes: true });
  let copied = 0;
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      copied += await copyAssets(rel);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".md")) continue;
    // The site serves `/docs/<dir>/<asset>`, which is the path a relative `src`
    // already produces, so the public copy is what makes images load.
    for (const target of [contentDir, assetDir]) {
      const destination = join(target, rel);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceDir, rel), destination);
    }
    copied += 1;
  }
  return copied;
}

/** `0002-pnpm-monorepo` -> `Pnpm monorepo`; `index` -> the folder's name. */
function humanize(rel) {
  const withoutExtension = rel.replace(/\.md$/, "");
  const base = posix.basename(withoutExtension);
  const name = base === "index" ? posix.basename(posix.dirname(withoutExtension)) : base;
  const words = name.replace(/^\d+-/, "").replaceAll(/[-_]+/g, " ").trim();
  if (words === "") return "Documentation";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Split leading YAML frontmatter from the body, keeping it verbatim. */
function splitFrontmatter(source) {
  if (!source.startsWith("---\n")) return { frontmatter: null, body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: source };
  const after = source.indexOf("\n", end + 4);
  return {
    frontmatter: source.slice(4, end),
    body: after === -1 ? "" : source.slice(after + 1),
  };
}

/** Quote a value as a YAML double-quoted scalar (JSON strings are valid YAML). */
function yamlString(value) {
  return JSON.stringify(value);
}

/** True for lines that open a block that is not prose. */
function isNonProse(line) {
  return (
    /^\s*($|#|>|\||-{2,}|\+{2,})/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s/.test(line) ||
    /^\s*!\[/.test(line) ||
    /^\s*<[a-zA-Z/]/.test(line) ||
    /^\s*\[\^/.test(line)
  );
}

/** Strip inline Markdown so the text can go into a `<meta>` description. */
function toPlainText(block) {
  return block
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/`([^`]*)`/g, "$1")
    .replaceAll(/(\*\*|__)(.*?)\1/g, "$2")
    .replaceAll(/(\*|_)(.*?)\1/g, "$2")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** First prose paragraph of the body, shortened to fit a meta description. */
function firstParagraph(body) {
  let block = [];
  let fenced = false;
  const blocks = [];
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.trim() === "") {
      if (block.length > 0) blocks.push(block.join(" "));
      block = [];
      continue;
    }
    block.push(line);
  }
  if (block.length > 0) blocks.push(block.join(" "));

  for (const candidate of blocks) {
    const lines = candidate.split("\n");
    if (lines.length === 1 && isNonProse(lines[0])) continue;
    if (lines.some(isNonProse)) continue;
    const text = toPlainText(candidate);
    if (text !== "") return truncate(text);
  }
  return undefined;
}

function truncate(text) {
  if (text.length <= DESCRIPTION_LIMIT) return text;
  const cut = text.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace === -1 ? DESCRIPTION_LIMIT : lastSpace).trimEnd()}…`;
}

/**
 * Rewrite one link target. Relative links inside `docs/` stay relative (the
 * renderer resolves them against the page's source file), everything else
 * becomes a GitHub URL so the site never points at a 404.
 */
function rewriteHref(href, rel, files, dirs) {
  if (
    href === "" ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    /^[a-zA-Z][\w+.-]*:/.test(href)
  ) {
    return href;
  }
  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);

  const baseDir = posix.dirname(rel);
  const resolved = posix.normalize(posix.join(baseDir, path));
  const repoPath = posix.normalize(posix.join("docs", resolved));
  // A link that climbs out of the repository is already broken; leave it alone
  // so `pnpm docs:check` keeps reporting it instead of hiding it here.
  if (repoPath.startsWith("..")) return href;

  if (repoPath !== "docs" && !repoPath.startsWith("docs/")) {
    const url = path.endsWith("/") ? `${GITHUB_TREE}${repoPath}/` : `${GITHUB_BLOB}${repoPath}`;
    return `${url}${hash}`;
  }

  const internal = repoPath === "docs" ? "" : repoPath.slice("docs/".length);

  const isDirectory = path.endsWith("/") || internal === "" || dirs.has(internal);
  if (isDirectory) {
    const folder = internal.replace(/\/$/, "");
    const prefix = folder === "" ? "" : `${folder}/`;
    if (files.has(`${prefix}README.md`) || files.has(`${prefix}index.md`)) {
      return withHash(relativeHref(baseDir, `${prefix}index.md`), hash);
    }
    // A folder with no index page has no URL on the site; point at the source.
    const target = folder === "" ? "docs" : `docs/${folder}`;
    return `${GITHUB_TREE}${target}${hash}`;
  }

  if (internal.endsWith(".md")) {
    const file =
      posix.basename(internal) === "README.md"
        ? `${posix.dirname(internal)}/index.md`.replace(/^\.\//, "")
        : internal;
    if (!files.has(internal)) return href;
    return withHash(relativeHref(baseDir, file), hash);
  }

  // A non-Markdown file next to the pages (an image, a fixture): keep it, the
  // sync copies it under `public/docs/` with the same shape.
  return href;
}

function relativeHref(fromDir, target) {
  const relative = posix.relative(fromDir, target);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function withHash(href, hash) {
  return `${href}${hash}`;
}

/** Rewrite links outside fenced code blocks (a literal `[x](y)` is not a link). */
function rewriteLinks(body, rel, files, dirs) {
  const lines = body.split("\n");
  let fenced = false;
  const output = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    return line.replaceAll(
      /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
      (_match, open, href, close) => `${open}${rewriteHref(href, rel, files, dirs)}${close}`,
    );
  });
  return output.join("\n");
}

/** Build the page body: frontmatter, then Markdown with a single H1 removed. */
function convertPage(source, rel, modified) {
  const { frontmatter, body: rawBody } = splitFrontmatter(source);
  const body = rawBody.replaceAll(/<!--[\s\S]*?-->/g, "");

  const lines = body.split("\n");
  const firstContent = lines.findIndex((line) => line.trim() !== "");
  const firstHeading =
    firstContent !== -1 && /^# \S/.test(lines[firstContent])
      ? lines[firstContent].slice(2).trim()
      : undefined;
  const declaredTitle = frontmatter
    ?.match(/^title\s*:\s*(.+)$/m)?.[1]
    ?.trim()
    .replaceAll(/^["']|["']$/g, "");
  // The heading is the title when frontmatter has none, and it is dropped from
  // the body in either case so the page never renders two H1s — but only when
  // it repeats the declared title, never to delete a heading of its own.
  const stripHeading =
    firstHeading !== undefined && (declaredTitle === undefined || declaredTitle === firstHeading);
  const heading = stripHeading ? firstHeading : undefined;
  const withoutHeading = stripHeading
    ? lines
        .slice(firstContent + 1)
        .join("\n")
        .replace(/^\n+/, "")
    : body;

  const title = heading ?? humanize(rel);
  const needsTitle = declaredTitle === undefined;
  const description = firstParagraph(withoutHeading) ?? undefined;

  if (frontmatter === null) {
    const fields = [`title: ${yamlString(title)}`];
    if (description !== undefined) fields.push(`description: ${yamlString(description)}`);
    fields.push(`lastModified: ${yamlString(modified)}`);
    return `---\n${fields.join("\n")}\n---\n\n${withoutHeading}`;
  }

  const fields = [];
  if (needsTitle) fields.push(`title: ${yamlString(title)}`);
  if (description !== undefined && !/^description\s*:/m.test(frontmatter)) {
    fields.push(`description: ${yamlString(description)}`);
  }
  if (!/^lastModified\s*:/m.test(frontmatter)) fields.push(`lastModified: ${yamlString(modified)}`);
  if (fields.length === 0) return `---\n${frontmatter}\n---\n\n${withoutHeading}`;
  // Keep the author's keys below the ones the site needs.
  return `---\n${[...fields, frontmatter].join("\n")}\n---\n\n${withoutHeading}`;
}

/** The `meta.json` for one directory: explicit order, index first. */
function buildMeta(dir, files, folders, isRoot) {
  const parent = dir === "" ? "." : dir;
  const children = [
    ...files
      .filter((file) => posix.dirname(file) === parent)
      .map((file) =>
        posix.basename(file) === "README.md" ? "index" : posix.basename(file).replace(/\.md$/, ""),
      ),
    ...folders
      .filter((folder) => posix.dirname(folder) === parent)
      .map((folder) => posix.basename(folder)),
  ];
  const sorted = children.sort((a, b) => (a < b ? -1 : 1));
  const order = isRoot ? ROOT_ORDER.filter((name) => sorted.includes(name)) : [];
  // Fumadocs' folder index is `index`; list it first when the folder has one.
  if (!isRoot && sorted.includes("index") && !order.includes("index")) order.push("index");
  const pages = [...order, ...sorted.filter((name) => !order.includes(name))];

  const meta = { pages };
  return meta;
}

/**
 * Directories a reader can open, i.e. the ones holding a page somewhere. A
 * folder of only assets (or of `.gitkeep`) must not become an empty sidebar
 * entry, so it gets no `meta.json`.
 */
function publishedDirectories(files) {
  const dirs = new Set([""]);
  for (const file of files) {
    let dir = posix.dirname(file);
    while (dir !== "." && dir !== "") {
      dirs.add(dir);
      dir = posix.dirname(dir);
    }
  }
  return dirs;
}

async function writeMetas(rootFiles, rootDirs) {
  const directories = [...publishedDirectories(rootFiles)].sort((a, b) => (a < b ? -1 : 1));
  const folders = rootDirs.filter((dir) => directories.includes(dir));
  for (const dir of directories) {
    const meta = buildMeta(dir, rootFiles, folders, dir === "");
    const target = join(contentDir, dir, "meta.json");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }
}

const { files, dirs } = await walk("");
const fileSet = new Set(files);
const dirSet = new Set(dirs);

await rm(contentDir, { recursive: true, force: true });
await mkdir(contentDir, { recursive: true });

for (const rel of files) {
  const source = await readFile(join(sourceDir, rel), "utf8");
  const page = rewriteLinks(convertPage(source, rel, lastModified(rel)), rel, fileSet, dirSet);
  const target = join(contentDir, rel.replace(/(^|\/)README\.md$/, "$1index.md"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, page, "utf8");
}

const assets = await copyAssets("");
await writeMetas(files, dirs);

process.stdout.write(
  `synced docs → apps/docs/content/docs: ${files.length} pages, ${publishedDirectories(files).size} meta.json, ${assets} assets\n`,
);
