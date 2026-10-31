import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

/** Every page in both spaces, as one Markdown file. */
export const prerender = true;

export const GET: APIRoute = async () => {
  const docs = await getCollection("docs");
  const handbook = await getCollection("handbook");

  const sections = [...docs, ...handbook]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => `# ${entry.data.title}\n\n${(entry.body ?? "").trimEnd()}`);

  return new Response(`${sections.join("\n\n---\n\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
