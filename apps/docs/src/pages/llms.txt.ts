import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

/**
 * The summary an agent reads first: what the site is, and one line per page in both spaces.
 *
 * The descriptions come from the pages' own frontmatter, so a page added to either space appears
 * here without an edit. Order is the authored order inside each space, which is also the sidebar.
 */
export const prerender = true;

const SITE = "https://docs.suite.run";

function line(title: string, url: string, description: string | undefined): string {
  return `- [${title}](${url})${description ? `: ${description}` : ""}`;
}

export const GET: APIRoute = async () => {
  const docs = await getCollection("docs");
  const handbook = await getCollection("handbook");

  const body = [
    "# Suite",
    "",
    "> A local-first collaborative canvas: one Loro document per workspace, a typed object graph",
    "> validated by @suite/graph, and a React 19 canvas.",
    "",
    "Two spaces: developer documentation under /docs, and the user handbook under /handbook. Every",
    "page is also served as Markdown by appending `.md` to its URL without the trailing slash.",
    "",
    "## Developer documentation",
    "",
    ...docs
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) =>
        line(
          entry.data.title,
          `${SITE}/docs/${entry.id.replace(/\.mdx$/, "")}.md`,
          entry.data.description,
        ),
      ),
    "",
    "## User handbook",
    "",
    ...handbook
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) =>
        line(
          entry.data.title,
          `${SITE}/handbook/${entry.id.replace(/\.mdx$/, "")}.md`,
          entry.data.description,
        ),
      ),
    "",
  ].join("\n");

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
