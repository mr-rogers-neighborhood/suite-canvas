import { getCollection } from "astro:content";
import type { APIRoute, GetStaticPaths } from "astro";

/**
 * One user article as Markdown, at the URL an agent guesses from the page it just read: drop the
 * trailing slash and append `.md`. The handbook has the same endpoint under its own base.
 */
export const prerender = true;

export const getStaticPaths = (async () => {
  const entries = await getCollection("handbook");
  return entries.map((entry) => ({
    // A collection id keeps its extension; the URL an agent guesses does not.
    params: { slug: entry.id.replace(/\.mdx$/, "") },
    props: { title: entry.data.title, body: entry.body ?? "" },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ title: string; body: string }> = ({ props }) =>
  new Response(`# ${props.title}\n\n${props.body.trimEnd()}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
