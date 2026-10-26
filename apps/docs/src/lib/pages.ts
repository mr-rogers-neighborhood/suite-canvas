import { getCollection } from "astro:content";
import { SECTIONS, type SectionId } from "./sections";

/** One row of the dashboard: a published page with the section it belongs to. */
export interface DashboardPage {
  url: string;
  title: string;
  description: string;
  section: SectionId;
  lastModified: string;
}

const SECTION_IDS = new Set<string>(SECTIONS.map((section) => section.id));

/**
 * A Starlight entry id is the path under `src/content/docs` without its
 * extension, and a folder index collapses to the folder: `reference/index.md` is
 * the entry `reference`, served at `/reference/`.
 */
function urlFor(id: string): string {
  return `/${id}/`;
}

/**
 * Every page in the four sections, newest first. The section overviews are left
 * out: the cards above the tabs link to them.
 */
export async function dashboardPages(): Promise<DashboardPage[]> {
  const entries = await getCollection("docs");
  const pages: DashboardPage[] = [];
  for (const entry of entries) {
    const segments = entry.id.split("/");
    const section = segments[0];
    if (section === undefined || !SECTION_IDS.has(section)) continue;
    // A single-segment id inside a section is that section's overview page.
    if (segments.length === 1) continue;
    pages.push({
      url: urlFor(entry.id),
      title: entry.data.title,
      description: entry.data.description ?? "",
      section: section as SectionId,
      lastModified: entry.data.lastModified ?? "",
    });
  }
  return pages.sort(
    (a, b) => b.lastModified.localeCompare(a.lastModified) || a.title.localeCompare(b.title),
  );
}

/** How many pages each section holds, for the card labels. */
export function countBySection(pages: readonly DashboardPage[]): Map<SectionId, number> {
  const counts = new Map<SectionId, number>(SECTIONS.map((section) => [section.id, 0]));
  for (const page of pages) counts.set(page.section, (counts.get(page.section) ?? 0) + 1);
  return counts;
}
