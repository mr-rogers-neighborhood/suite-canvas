import { notFound } from "next/navigation";
import { docsLlms, getSource } from "@/lib/source";

export const revalidate = false;

interface RouteProps {
  params: Promise<{ slug?: string[] }>;
}

/** The Markdown of one page. `next.config.mjs` rewrites `/docs/*.md` here. */
export async function GET(_request: Request, { params }: RouteProps) {
  const { slug } = await params;
  // The rewrite appends `content.md`, and `/docs/index.md` is the root page.
  const slugs = slug === undefined ? [] : slug.slice(0, -1);
  if (slugs.at(-1) === "index") slugs.pop();

  const source = await getSource();
  const page = source.getPage(slugs);
  if (!page) notFound();

  return new Response(await docsLlms.page(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export async function generateStaticParams() {
  const source = await getSource();
  return source.generateParams().map((params) => ({
    ...params,
    slug: [...params.slug, "content.md"],
  }));
}
