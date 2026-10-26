import path from "node:path";
import { localMd } from "@fumadocs/local-md";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins/rehype-code";
import { dynamicLoader, llms } from "fumadocs-core/source";
import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

/**
 * The pages are mirrored from `docs/` by `scripts/sync-docs.mjs`, which adds
 * the `title`/`description` frontmatter the default schema requires. Reading
 * them at runtime keeps one source of truth: the repository's Markdown.
 *
 * `fallbackLanguage` matters: two fences in `docs/` name languages the bundled
 * Shiki grammars do not ship (`cron`, `caddyfile`). Rendering an unknown
 * language as plain text keeps those pages buildable instead of failing them.
 */
const docs = localMd({
  dir: path.join(process.cwd(), "content/docs"),
  frontmatterSchema: pageSchema.extend({
    lastModified: z.string().optional(),
  }),
  mdOptions: {
    rehypeCodeOptions: { ...rehypeCodeDefaultOptions, fallbackLanguage: "text" },
  },
});

const loader = dynamicLoader(docs.dynamicSource(), { baseUrl: "/docs" });

/** The loader output, for pages, layouts and the search index. */
export const getSource = () => loader.get();

/**
 * The same pages as Markdown, for `llms.txt`, `llms-full.txt` and `/docs/*.md`.
 * `page.data.content` is the body after the injected frontmatter, with the H1
 * removed, so the heading is added back here.
 */
export const docsLlms = llms(getSource, {
  renderPage: (page) => `# ${page.data.title} (${page.url})\n\n${page.data.content}`,
});
