import { createGetUrl } from "fumadocs-core/source";

export const site = {
  name: "Suite",
  description:
    "Documentation for Suite, a local-first collaborative canvas with a typed object graph.",
  githubUrl: "https://github.com/mr-rogers-neighborhood/suite-canvas",
  githubBranch: "main",
} as const;

/** Where one page's Markdown is served for agents (`/docs/x.md` rewrites here). */
export const docsContentRoute = "/llms.mdx/docs";

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string | undefined }): string {
  return getContentUrl([...page.slugs, "content.md"], page.locale);
}

/**
 * The page's file in the repository. `README.md` became `index.md` when the
 * content was synced, so the reverse maps an index page back to its README.
 */
export function getPageSourceUrl(page: { slugs: string[] }): string {
  const path = page.slugs.length === 0 ? ["README"] : page.slugs;
  const file = path.at(-1) === "index" ? [...path.slice(0, -1), "README"] : path;
  return `${site.githubUrl}/blob/${site.githubBranch}/docs/${file.join("/")}.md`;
}
