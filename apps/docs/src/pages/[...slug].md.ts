import { getCollection } from "astro:content";
import type { APIRoute, GetStaticPaths } from "astro";

/**
 * One page as Markdown, at the URL an agent guesses from the page it just read:
 * drop the trailing slash and append `.md`, so `/reference/architecture/` has
 * `/reference/architecture.md` and `/reference/` has `/reference.md`.
 *
 * `llms.txt` and `llms-full.txt` come from `starlight-llms-txt`; this route is
 * the per-page half of the trio. The body is the Markdown `scripts/sync-docs.mjs`
 * wrote, with the title it derived put back as the H1, and relative links keep
 * working because the `.md` paths mirror the page paths.
 */
interface PageProps {
  title: string;
  body: string;
}

export const getStaticPaths = (async () => {
  const entries = await getCollection("docs");
  return entries.map((entry) => ({
    params: { slug: entry.id },
    props: { title: entry.data.title, body: entry.body ?? "" } satisfies PageProps,
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<PageProps> = ({ props }) =>
  new Response(`# ${props.title}\n\n${props.body.trimEnd()}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
