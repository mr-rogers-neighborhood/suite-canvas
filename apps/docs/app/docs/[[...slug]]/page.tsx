import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsDashboard } from "@/components/docs-dashboard";
import { getMDXComponents } from "@/components/mdx";
import { getPageMarkdownUrl, getPageSourceUrl } from "@/lib/shared";
import { getSource } from "@/lib/source";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  if (slug === undefined || slug.length === 0) return <DocsDashboard />;
  const source = await getSource();
  const page = source.getPage(slug);
  if (!page) notFound();

  const markdownUrl = getPageMarkdownUrl(page);
  const { body, toc } = await (await page.data.load()).render(
    getMDXComponents({
      // Relative links are written against the Markdown file, not the URL.
      a: createRelativeLink(source, page),
    }),
  );

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description === undefined ? null : (
        <DocsDescription>{page.data.description}</DocsDescription>
      )}
      <div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={getPageSourceUrl(page)} />
      </div>
      <DocsBody>{body}</DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  const source = await getSource();
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (slug === undefined || slug.length === 0) return { title: "Suite documentation" };
  const source = await getSource();
  const page = source.getPage(slug);
  if (!page) return {};
  return {
    title: page.data.title,
    ...(page.data.description === undefined ? {} : { description: page.data.description }),
  };
}
