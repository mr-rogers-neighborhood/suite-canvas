/**
 * The four Diátaxis sections, in the order the dashboard shows them. The ids are
 * the directory names under `docs/`, so `scripts/sync-docs.mjs` and the sidebar
 * in `astro.config.mjs` name the same four things.
 */
export const SECTIONS = [
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

export type SectionId = (typeof SECTIONS)[number]["id"];
