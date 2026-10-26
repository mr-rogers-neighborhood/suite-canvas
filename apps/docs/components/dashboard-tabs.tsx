"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface DashboardPage {
  url: string;
  title: string;
  description: string;
  section: string;
  lastModified: string;
}

const SECTIONS = [
  { id: "tutorials", label: "Tutorials" },
  { id: "how-to", label: "How-to" },
  { id: "reference", label: "Reference" },
  { id: "explanation", label: "Explanation" },
] as const;

export function DashboardTabs({ pages }: { pages: DashboardPage[] }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("tutorials");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pages
      .filter((page) => page.section === section)
      .filter(
        (page) =>
          needle === "" || `${page.title} ${page.description}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }, [pages, query, section]);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex gap-1" role="tablist" aria-label="Documentation sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              onClick={() => setSection(item.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                section === item.id
                  ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="mb-2 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <span className="sr-only">Filter pages</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter this section"
            className="w-52 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-600"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">No pages match.</p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
          {visible.map((page) => (
            <li key={page.url} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={page.url}
                  className="text-base font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  {page.title}
                </Link>
                {page.lastModified ? (
                  <time
                    dateTime={page.lastModified.slice(0, 10)}
                    className="text-xs text-neutral-500 dark:text-neutral-400"
                  >
                    {page.lastModified.slice(0, 10)}
                  </time>
                ) : null}
              </div>
              {page.description ? (
                <p className="mt-1 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
                  {page.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
