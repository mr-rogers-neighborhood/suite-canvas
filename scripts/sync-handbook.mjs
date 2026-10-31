/**
 * Turns `handbook/*.md` into the two things that read it.
 *
 * The articles are authored once, in Markdown, at the repository root, because the person who
 * writes them writes Markdown (ADR-0045 amendment). Two readers need different shapes:
 *
 *   - the app wants a typed module with the body already rendered, since shipping a Markdown
 *     parser into the canvas to render five paragraphs is a dependency the bundle never needs;
 *   - the docs site wants MDX in an Astro content collection, with the frontmatter Fumadocs
 *     reads and a `meta.json` per directory so the sidebar has an order.
 *
 * So this script is the adapter, and its output is a pure function of `handbook/`: the targets
 * are cleared first, files are walked in sorted order, and nothing is read from a previous run.
 * `--check` compares instead of writing, which is how `pnpm docs:check` notices an article that
 * was edited without regenerating.
 *
 * It also holds the two invariants that make the handbook honest:
 *
 *   1. An article may only name a region that `regions.ts` declares.
 *   2. Every declared region must be named by at least one article.
 *
 * Without the first, a typo silently produces an article that never matches anything. Without
 * the second, the handbook claims to document the interface while quietly skipping a control.
 *
 * Usage:
 *   node scripts/sync-handbook.mjs            # rewrite both outputs
 *   node scripts/sync-handbook.mjs --check    # exit 1 when either output is stale
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { parse as parseYaml } from "yaml";
import { registerTypeScript } from "./ts-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "handbook");
const canvasTarget = join(root, "apps/canvas/src/handbook/articles.generated.ts");
const docsTarget = join(root, "apps/docs/src/content/handbook");

registerTypeScript();
const { HANDBOOK_REGIONS, isHandbookRegion } = await import(
  "../apps/canvas/src/handbook/regions.ts"
);

const TARGET_KINDS = new Set(["ui", "card", "board", "section"]);
const DEFAULT_ORDER = 100;

/** A problem with the authored files, reported as a sentence naming the file. */
class HandbookError extends Error {}

function fail(file, message) {
  throw new HandbookError(`${relative(root, file)}: ${message}`);
}

/** Frontmatter and body, split without a Markdown parser fighting the YAML. */
function splitFrontmatter(text, file) {
  if (!text.startsWith("---\n")) fail(file, "needs frontmatter: the file must start with `---`");
  const end = text.indexOf("\n---", 4);
  if (end === -1) fail(file, "frontmatter is not closed with `---`");
  const yaml = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  let data;
  try {
    data = parseYaml(yaml);
  } catch (error) {
    fail(file, `frontmatter is not valid YAML: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail(file, "frontmatter must be a mapping");
  }
  return { data, body };
}

/** The targets an article declares, checked against the kinds and the region registry. */
function readTargets(data, file) {
  const raw = data.targets;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail(file, "`targets` must be a list");
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null)
      fail(file, `targets[${index}] is not a mapping`);
    const kind = entry.kind;
    const id = entry.id;
    if (typeof kind !== "string" || !TARGET_KINDS.has(kind)) {
      fail(file, `targets[${index}].kind must be one of ${[...TARGET_KINDS].join(", ")}`);
    }
    if (typeof id !== "string" || id.trim().length === 0) {
      fail(file, `targets[${index}].id is required`);
    }
    if (kind === "ui" && !isHandbookRegion(id)) {
      fail(
        file,
        `targets[${index}] names the region "${id}", which is not in apps/canvas/src/handbook/regions.ts`,
      );
    }
    return { kind, id };
  });
}

/** Plain text from rendered HTML, for search and the one-line summary in a list. */
function plainText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escapes the three characters that turn prose into JSX when a `.md` becomes `.mdx`.
 *
 * Fenced blocks and inline code are skipped: escaping inside them would change what the reader
 * sees rather than what the parser sees.
 */
function escapeForMdx(body) {
  const lines = body.split("\n");
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // Inline code spans are kept verbatim; everything else is escaped.
      return line
        .split(/(`[^`]*`)/)
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part.replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/</g, "\\<"),
        )
        .join("");
    })
    .join("\n");
}

function readSections() {
  const file = join(sourceDir, "_sections.json");
  if (!existsSync(file)) fail(file, "is missing: it names the sections and their order");
  const sections = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(sections) || sections.length === 0)
    fail(file, "must list at least one section");
  const seen = new Set();
  for (const section of sections) {
    if (typeof section.id !== "string" || section.id.length === 0)
      fail(file, "every section needs an id");
    if (seen.has(section.id)) fail(file, `duplicate section id "${section.id}"`);
    seen.add(section.id);
    if (typeof section.title !== "string" || section.title.length === 0) {
      fail(file, `section "${section.id}" needs a title`);
    }
  }
  return [...sections].sort(
    (left, right) => (left.order ?? DEFAULT_ORDER) - (right.order ?? DEFAULT_ORDER),
  );
}

function readArticles(sections) {
  const articles = [];
  for (const section of sections) {
    const directory = join(sourceDir, section.id);
    if (!existsSync(directory)) continue;
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".md"))
      .sort();
    for (const name of files) {
      const file = join(directory, name);
      const { data, body } = splitFrontmatter(readFileSync(file, "utf8"), file);
      if (typeof data.title !== "string" || data.title.trim().length === 0) {
        fail(file, "frontmatter needs a `title`");
      }
      if (body.trim().length === 0) fail(file, "has no body");
      const slug = name.slice(0, -3);
      const html = marked.parse(body, { async: false, gfm: true });
      articles.push({
        id: `${section.id}/${slug}`,
        slug,
        section: section.id,
        title: data.title.trim(),
        description:
          typeof data.description === "string" && data.description.trim().length > 0
            ? data.description.trim()
            : (plainText(html).split(/(?<=\.)\s/)[0] ?? ""),
        order: typeof data.order === "number" ? data.order : DEFAULT_ORDER,
        targets: readTargets(data, file),
        html,
        text: plainText(html),
        body,
        file,
      });
    }
  }
  return articles;
}

/** Every declared region needs an article; an undocumented control is a silent gap. */
function assertCoverage(articles) {
  const documented = new Set(
    articles.flatMap((article) =>
      article.targets.filter((target) => target.kind === "ui").map((target) => target.id),
    ),
  );
  const missing = HANDBOOK_REGIONS.filter((region) => !documented.has(region.id));
  if (missing.length > 0) {
    throw new HandbookError(
      `handbook/: these regions have no article: ${missing.map((region) => region.id).join(", ")}\n` +
        "  Write one, or remove the region from apps/canvas/src/handbook/regions.ts.",
    );
  }
}

function canvasModule(articles) {
  const rows = articles.map((article) => ({
    id: article.id,
    slug: article.slug,
    title: article.title,
    description: article.description,
    section: article.section,
    order: article.order,
    targets: article.targets,
    html: article.html,
    text: article.text,
  }));
  return `// Generated by scripts/sync-handbook.mjs from handbook/. Do not edit by hand.\n// \`node scripts/sync-handbook.mjs\` rewrites it; \`pnpm docs:check\` fails when it is stale.\nimport type { HandbookArticle } from "./types";\n\nexport const HANDBOOK_ARTICLES: readonly HandbookArticle[] = ${JSON.stringify(rows, null, 2)};\n`;
}

/** The files the docs site owns: one MDX per article and a `meta.json` per directory. */
function docsFiles(sections, articles) {
  const files = new Map();
  const rootPages = sections.map((section) => section.id);
  files.set(
    join(docsTarget, "_meta.json"),
    `${JSON.stringify({ title: "User handbook", pages: rootPages }, null, 2)}\n`,
  );
  for (const section of sections) {
    const members = articles
      .filter((article) => article.section === section.id)
      .sort((left, right) => left.order - right.order || left.slug.localeCompare(right.slug));
    files.set(
      join(docsTarget, section.id, "_meta.json"),
      `${JSON.stringify(
        { title: section.title, pages: members.map((article) => article.slug) },
        null,
        2,
      )}\n`,
    );
    for (const article of members) {
      const frontmatter = ["---", `title: ${JSON.stringify(article.title)}`];
      if (article.description.length > 0) {
        frontmatter.push(`description: ${JSON.stringify(article.description)}`);
      }
      frontmatter.push("---", "");
      files.set(
        join(docsTarget, section.id, `${article.slug}.mdx`),
        `${frontmatter.join("\n")}${escapeForMdx(article.body)}\n`,
      );
    }
  }
  return files;
}

/** What is on disk under a directory, as paths relative to it, excluding what we write. */
function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(directory);
  return found;
}

function writeAll(files, check) {
  const stale = [];
  for (const [path, content] of files) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === content) continue;
    stale.push(path);
    if (check) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return stale;
}

const check = process.argv.includes("--check");

try {
  const sections = readSections();
  const articles = readArticles(sections);
  assertCoverage(articles);

  const files = new Map([[canvasTarget, canvasModule(articles)], ...docsFiles(sections, articles)]);
  const expected = new Set(files.keys());

  // The docs tree is generated, so a file nobody produces is stale by definition. Only .mdx and
  // _meta.json are ours: anything else in that directory is a mistake someone should see.
  const orphans = existingFiles(docsTarget).filter((path) => !expected.has(path));

  const stale = writeAll(files, check);
  if (check) {
    if (stale.length > 0) {
      console.error(
        `handbook is out of date (${stale.length} file${stale.length === 1 ? "" : "s"}):\n` +
          stale.map((path) => `  ${relative(root, path)}`).join("\n") +
          "\nRun `node scripts/sync-handbook.mjs`.",
      );
      process.exitCode = 1;
    }
    if (orphans.length > 0) {
      console.error(
        `apps/docs/src/content/handbook has files no article produces:\n` +
          orphans.map((path) => `  ${relative(root, path)}`).join("\n"),
      );
      process.exitCode = 1;
    }
  } else if (!check && existsSync(docsTarget)) {
    // A rewrite removes pages that no longer exist; leaving them would publish a deleted article.
    for (const path of orphans) rmSync(path);
  }

  if (!check) {
    const count = articles.length;
    console.log(
      `handbook: ${count} article${count === 1 ? "" : "s"} from ${sections.length} sections, ` +
        `${HANDBOOK_REGIONS.length} regions documented`,
    );
  }
} catch (error) {
  if (error instanceof HandbookError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
