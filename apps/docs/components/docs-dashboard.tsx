import Link from "next/link";
import { type DashboardPage, DashboardTabs } from "@/components/dashboard-tabs";
import { getSource } from "@/lib/source";

const SECTIONS = [
  {
    id: "tutorials",
    label: "Tutorials",
    blurb: "Learn by doing. One guided path to a first success.",
  },
  {
    id: "how-to",
    label: "How-to",
    blurb: "One task at a time: test, deploy, operate, release, contribute.",
  },
  {
    id: "reference",
    label: "Reference",
    blurb: "Facts to look up: the model, commands, limits, security boundary.",
  },
  {
    id: "explanation",
    label: "Explanation",
    blurb: "Why the product and the code are shaped this way.",
  },
] as const;

export async function DocsDashboard() {
  const docs = await getSource();
  const pages: DashboardPage[] = docs
    .getPages()
    .map((page) => ({
      url: page.url,
      title: page.data.title,
      description: page.data.description ?? "",
      section: page.slugs[0] ?? "",
      lastModified:
        (page.data.frontmatter as { lastModified?: string } | undefined)?.lastModified ?? "",
    }))
    .filter(
      (page) =>
        SECTIONS.some((section) => section.id === page.section) &&
        page.url !== `/docs/${page.section}`,
    );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
        Beta, 0.2.0-beta.1
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Suite documentation
      </h1>
      <p className="mt-3 max-w-3xl text-neutral-600 dark:text-neutral-400">
        A local-first, collaborative canvas. A workspace owns its cards; boards are views of those
        cards. The document is a Loro CRDT, every write is validated in <code>@suite/graph</code>,
        and the canvas works offline.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) => {
          const count = pages.filter((page) => page.section === section.id).length;
          return (
            <Link
              key={section.id}
              href={`/docs/${section.id}`}
              className="group rounded-lg border border-neutral-200 p-5 transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
                  {section.label}
                </h2>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {count} {count === 1 ? "page" : "pages"}
                </span>
              </div>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{section.blurb}</p>
            </Link>
          );
        })}
      </div>

      <DashboardTabs pages={pages} />
    </main>
  );
}
